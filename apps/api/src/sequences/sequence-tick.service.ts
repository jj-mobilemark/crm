import {
	ActivityType,
	type Db,
	EmailDirection,
	EmailSequenceStatus,
	SequenceEnrollmentStatus,
	SequenceStepRunStatus,
} from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../config/env.validation";
import { ActivityStampService } from "../crm/activity-stamp.service";
import { InjectDatabase } from "../database/database.constants";
import { MicrosoftTokenService } from "../microsoft/microsoft-token.service";
import { OutlookSendClient } from "../microsoft/outlook-send.client";
import {
	injectTracking,
	isInsideSendWindow,
	type MergeContext,
	nextSendWindowOpen,
	parseSendDays,
	renderMerge,
} from "./sequence-render";

/** One cron tick budget — leave headroom under Vercel's ~60s limit. */
const TICK_BUDGET_MS = 50_000;
const LEASE_MS = 5 * 60_000;
const BATCH = 25;

type LeasedEnrollment = {
	id: string;
	sequenceId: string;
	contactId: string;
	senderUserId: string;
	currentStepOrder: number;
	threadInternetMessageId: string | null;
	createdAt: Date;
};

export type SequenceTickSummary = {
	processed: number;
	sent: number;
	deferred: number;
	stopped: number;
	failed: number;
};

/**
 * Cron-driven sequence sender.
 *
 * Leases due ACTIVE enrollments, checks reply / unsubscribe / sending window,
 * renders merge fields, sends via Graph, logs a timeline Activity, and advances
 * or completes the enrollment.
 */
@Injectable()
export class SequenceTickService {
	private readonly logger = new Logger(SequenceTickService.name);
	private readonly publicBaseUrl: string;

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly tokens: MicrosoftTokenService,
		private readonly send: OutlookSendClient,
		private readonly stamp: ActivityStampService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		const appPublic = config.get("APP_PUBLIC_URL", { infer: true });
		const apiUrl = config.get("API_URL", { infer: true });
		const appUrl = config.get("APP_URL", { infer: true });
		this.publicBaseUrl = (
			appPublic ||
			apiUrl ||
			appUrl?.split(",")[0] ||
			"http://localhost:3001"
		).replace(/\/$/, "");
	}

	async runDue(): Promise<SequenceTickSummary> {
		const startedAt = Date.now();
		const summary: SequenceTickSummary = {
			processed: 0,
			sent: 0,
			deferred: 0,
			stopped: 0,
			failed: 0,
		};

		while (Date.now() - startedAt < TICK_BUDGET_MS) {
			const batch = await this.claimDue(BATCH);
			if (batch.length === 0) break;

			for (const enrollment of batch) {
				if (Date.now() - startedAt >= TICK_BUDGET_MS) break;
				summary.processed += 1;
				const outcome = await this.processOne(enrollment);
				summary[outcome] += 1;
			}
		}

		this.logger.log({ message: "Sequence tick finished", ...summary });
		return summary;
	}

	private async claimDue(limit: number): Promise<LeasedEnrollment[]> {
		const now = new Date();
		const until = new Date(now.getTime() + LEASE_MS);

		return this.db.$queryRaw<LeasedEnrollment[]>`
			UPDATE "sequenceEnrollment" AS e
			SET "leasedUntil" = ${until}
			FROM (
				SELECT e2.id
				FROM "sequenceEnrollment" AS e2
				INNER JOIN "emailSequence" AS s ON s.id = e2."sequenceId"
				WHERE e2.status = 'ACTIVE'::"SequenceEnrollmentStatus"
					AND s.status = 'ACTIVE'::"EmailSequenceStatus"
					AND e2."nextRunAt" <= ${now}
					AND (e2."leasedUntil" IS NULL OR e2."leasedUntil" < ${now})
				ORDER BY e2."nextRunAt" ASC
				LIMIT ${limit}
				FOR UPDATE OF e2 SKIP LOCKED
			) AS due
			WHERE e.id = due.id
			RETURNING e.id, e."sequenceId", e."contactId", e."senderUserId",
				e."currentStepOrder", e."threadInternetMessageId", e."createdAt";
		`;
	}

	private async processOne(
		enrollment: LeasedEnrollment,
	): Promise<"sent" | "deferred" | "stopped" | "failed"> {
		const sequence = await this.db.emailSequence.findUnique({
			where: { id: enrollment.sequenceId },
			select: {
				id: true,
				status: true,
				timezone: true,
				sendWindowStartMinute: true,
				sendWindowEndMinute: true,
				sendDays: true,
				stopOnReply: true,
				trackingEnabled: true,
				steps: {
					orderBy: { order: "asc" },
					select: {
						id: true,
						order: true,
						delayMinutes: true,
						subject: true,
						bodyTemplate: true,
					},
				},
			},
		});

		if (!sequence || sequence.status !== EmailSequenceStatus.ACTIVE) {
			await this.release(enrollment.id);
			return "deferred";
		}

		const contact = await this.db.contact.findUnique({
			where: { id: enrollment.contactId },
			select: {
				id: true,
				firstName: true,
				lastName: true,
				email: true,
				title: true,
				companyId: true,
				company: { select: { name: true } },
			},
		});

		if (!contact?.email) {
			await this.stop(
				enrollment.id,
				SequenceEnrollmentStatus.FAILED,
				"Contact has no email.",
			);
			return "failed";
		}

		const email = contact.email.trim().toLowerCase();
		const unsub = await this.db.sequenceUnsubscribe.findUnique({
			where: { email },
			select: { id: true },
		});
		if (unsub) {
			await this.stop(
				enrollment.id,
				SequenceEnrollmentStatus.UNSUBSCRIBED,
				"Address unsubscribed.",
			);
			return "stopped";
		}

		if (sequence.stopOnReply) {
			const replied = await this.hasInboundReply(
				email,
				enrollment.createdAt,
			);
			if (replied) {
				await this.stop(
					enrollment.id,
					SequenceEnrollmentStatus.STOPPED_REPLIED,
					"Contact replied.",
				);
				return "stopped";
			}
		}

		const windowOpts = {
			timezone: sequence.timezone,
			sendWindowStartMinute: sequence.sendWindowStartMinute,
			sendWindowEndMinute: sequence.sendWindowEndMinute,
			sendDays: parseSendDays(sequence.sendDays),
		};
		const now = new Date();
		if (!isInsideSendWindow(now, windowOpts)) {
			const next = nextSendWindowOpen(now, windowOpts);
			await this.db.sequenceEnrollment.update({
				where: { id: enrollment.id },
				data: { nextRunAt: next, leasedUntil: null },
			});
			return "deferred";
		}

		const step = sequence.steps.find(
			(s) => s.order === enrollment.currentStepOrder,
		);
		if (!step) {
			await this.stop(
				enrollment.id,
				SequenceEnrollmentStatus.COMPLETED,
				"No more steps.",
			);
			return "stopped";
		}

		const sender = await this.db.user.findUnique({
			where: { id: enrollment.senderUserId },
			select: { id: true, name: true },
		});

		const tokenResult = await this.tokens.accessTokenForSend(
			enrollment.senderUserId,
		);
		if (tokenResult.outcome === "needs-reconnect") {
			await this.stop(
				enrollment.id,
				SequenceEnrollmentStatus.NEEDS_RECONNECT,
				tokenResult.reason,
			);
			return "failed";
		}
		if (tokenResult.outcome !== "ok") {
			await this.db.sequenceEnrollment.update({
				where: { id: enrollment.id },
				data: {
					nextRunAt: new Date(Date.now() + 30 * 60_000),
					leasedUntil: null,
					stoppedReason: tokenResult.reason,
				},
			});
			return "deferred";
		}

		const mergeCtx: MergeContext = {
			firstName: contact.firstName,
			lastName: contact.lastName ?? "",
			fullName: [contact.firstName, contact.lastName]
				.filter(Boolean)
				.join(" "),
			email: contact.email,
			companyName: contact.company?.name ?? "",
			title: contact.title ?? "",
			senderName: sender?.name ?? "",
		};

		const subject = renderMerge(step.subject, mergeCtx);
		const trackingToken = crypto.randomUUID().replace(/-/g, "");
		const htmlBody = injectTracking(renderMerge(step.bodyTemplate, mergeCtx), {
			enabled: sequence.trackingEnabled,
			publicBaseUrl: this.publicBaseUrl,
			trackingToken,
		});

		const sendResult = await this.send.sendMail(tokenResult.accessToken, {
			to: contact.email,
			subject,
			htmlBody,
			inReplyTo: enrollment.threadInternetMessageId ?? undefined,
			headers: [
				{
					name: "List-Unsubscribe",
					value: `<${this.publicBaseUrl}/u/${trackingToken}>`,
				},
			],
		});

		if (sendResult.outcome === "rate-limited") {
			await this.db.sequenceEnrollment.update({
				where: { id: enrollment.id },
				data: {
					nextRunAt: new Date(
						Date.now() + (sendResult.retryAfterMs ?? 60_000),
					),
					leasedUntil: null,
				},
			});
			return "deferred";
		}

		if (sendResult.outcome === "unauthorized") {
			await this.stop(
				enrollment.id,
				SequenceEnrollmentStatus.NEEDS_RECONNECT,
				sendResult.reason,
			);
			return "failed";
		}

		if (sendResult.outcome !== "ok") {
			await this.db.sequenceStepRun.create({
				data: {
					enrollmentId: enrollment.id,
					stepId: step.id,
					status: SequenceStepRunStatus.FAILED,
					error: sendResult.reason,
					trackingToken,
				},
			});

			const retryable =
				sendResult.outcome === "failed" ? sendResult.retryable : true;

			if (!retryable) {
				await this.stop(
					enrollment.id,
					SequenceEnrollmentStatus.FAILED,
					sendResult.reason,
				);
				return "failed";
			}

			await this.db.sequenceEnrollment.update({
				where: { id: enrollment.id },
				data: {
					nextRunAt: new Date(Date.now() + 15 * 60_000),
					leasedUntil: null,
				},
			});
			return "deferred";
		}

		const sentAt = new Date();
		await this.db.sequenceStepRun.create({
			data: {
				enrollmentId: enrollment.id,
				stepId: step.id,
				status: SequenceStepRunStatus.SENT,
				sentAt,
				trackingToken,
			},
		});

		const activity = await this.db.activity.create({
			data: {
				type: ActivityType.EMAIL,
				subject,
				body: `Sequence step ${step.order + 1}: ${subject}`,
				occurredAt: sentAt,
				companyId: contact.companyId,
				contactId: contact.id,
				createdById: enrollment.senderUserId,
				meta: {
					source: "sequence",
					sequenceId: sequence.id,
					enrollmentId: enrollment.id,
					stepId: step.id,
					stepOrder: step.order,
				},
			},
			select: { createdAt: true },
		});
		await this.stamp.touch(
			{ companyId: contact.companyId, contactId: contact.id },
			activity.createdAt,
		);

		const nextStep = sequence.steps.find(
			(s) => s.order === enrollment.currentStepOrder + 1,
		);

		if (!nextStep) {
			await this.db.sequenceEnrollment.update({
				where: { id: enrollment.id },
				data: {
					status: SequenceEnrollmentStatus.COMPLETED,
					leasedUntil: null,
					stoppedReason: null,
					currentStepOrder: enrollment.currentStepOrder,
				},
			});
		} else {
			const due = new Date(
				sentAt.getTime() + nextStep.delayMinutes * 60_000,
			);
			const nextRunAt = isInsideSendWindow(due, windowOpts)
				? due
				: nextSendWindowOpen(due, windowOpts);

			await this.db.sequenceEnrollment.update({
				where: { id: enrollment.id },
				data: {
					currentStepOrder: nextStep.order,
					nextRunAt,
					leasedUntil: null,
				},
			});
		}

		return "sent";
	}

	private async hasInboundReply(
		fromEmail: string,
		since: Date,
	): Promise<boolean> {
		const found = await this.db.emailMessage.findFirst({
			where: {
				direction: EmailDirection.INBOUND,
				fromEmail: { equals: fromEmail, mode: "insensitive" },
				sentAt: { gte: since },
			},
			select: { id: true },
		});
		return found !== null;
	}

	private async stop(
		id: string,
		status: SequenceEnrollmentStatus,
		reason: string,
	) {
		await this.db.sequenceEnrollment.update({
			where: { id },
			data: { status, stoppedReason: reason, leasedUntil: null },
		});
	}

	private async release(id: string) {
		await this.db.sequenceEnrollment.update({
			where: { id },
			data: { leasedUntil: null },
		});
	}

	/** Record an open from the tracking pixel. */
	async recordOpen(token: string): Promise<boolean> {
		const run = await this.db.sequenceStepRun.findUnique({
			where: { trackingToken: token },
			select: { id: true, openedAt: true },
		});
		if (!run) return false;
		if (!run.openedAt) {
			await this.db.sequenceStepRun.update({
				where: { id: run.id },
				data: { openedAt: new Date() },
			});
		}
		return true;
	}

	/** Record a click. */
	async recordClick(token: string): Promise<boolean> {
		const run = await this.db.sequenceStepRun.findUnique({
			where: { trackingToken: token },
			select: { id: true, clickedAt: true, openedAt: true },
		});
		if (!run) return false;
		await this.db.sequenceStepRun.update({
			where: { id: run.id },
			data: {
				clickedAt: run.clickedAt ?? new Date(),
				openedAt: run.openedAt ?? new Date(),
			},
		});
		return true;
	}

	/** Unsubscribe by tracking token — stops the enrollment + global suppress. */
	async unsubscribe(token: string): Promise<{ ok: boolean; email?: string }> {
		const run = await this.db.sequenceStepRun.findUnique({
			where: { trackingToken: token },
			select: {
				id: true,
				enrollment: {
					select: {
						id: true,
						contact: { select: { email: true } },
					},
				},
			},
		});
		if (!run?.enrollment.contact.email) {
			return { ok: false };
		}

		const email = run.enrollment.contact.email.trim().toLowerCase();
		await this.db.sequenceUnsubscribe.upsert({
			where: { email },
			create: { email, reason: "Unsubscribed via sequence link." },
			update: {},
		});
		await this.db.sequenceEnrollment.update({
			where: { id: run.enrollment.id },
			data: {
				status: SequenceEnrollmentStatus.UNSUBSCRIBED,
				stoppedReason: "Unsubscribed via link.",
				leasedUntil: null,
			},
		});

		return { ok: true, email };
	}
}
