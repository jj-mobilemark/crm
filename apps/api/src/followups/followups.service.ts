import { ActivityType, type Db } from "@crm/db";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { ActivityStampService } from "../crm/activity-stamp.service";
import { InjectDatabase } from "../database/database.constants";
import type { FollowupDecideInput } from "./followups.contracts";

/** A day, for the default due date a bare "accept" without a date gets. */
const DEFAULT_DUE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * The per-rep Follow-ups panel — the API's half of Phase 5.
 *
 * What the agent decided lives in `FollowUpSuggestion`, written by the
 * `propose_followups` tool. This service only ever reads a rep's own rows and
 * turns an accepted one into a real `Activity` TASK — it never proposes
 * anything itself, and it never sees another rep's queue.
 */
@Injectable()
export class FollowupsService {
	private readonly logger = new Logger(FollowupsService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly agent: AgentTriggerService,
		private readonly stamp: ActivityStampService,
	) {}

	/** Mine: PROPOSED, plus SNOOZED ones whose snooze has come due. */
	async list(userId: string) {
		const now = new Date();

		const rows = await this.db.followUpSuggestion.findMany({
			where: {
				userId,
				OR: [
					{ status: "PROPOSED" },
					{ status: "SNOOZED", dueHint: { lte: now } },
				],
			},
			orderBy: [
				{ dueHint: { sort: "asc", nulls: "last" } },
				{ createdAt: "desc" },
			],
		});

		const [contacts, companies, deals] = await Promise.all([
			this.db.contact.findMany({
				where: { id: { in: unique(rows.map((row) => row.contactId)) } },
				select: { id: true, firstName: true, lastName: true },
			}),
			this.db.company.findMany({
				where: { id: { in: unique(rows.map((row) => row.companyId)) } },
				select: { id: true, name: true },
			}),
			this.db.deal.findMany({
				where: { id: { in: unique(rows.map((row) => row.dealId)) } },
				select: { id: true, name: true, stage: true },
			}),
		]);

		const contactById = new Map(contacts.map((row) => [row.id, row]));
		const companyById = new Map(companies.map((row) => [row.id, row]));
		const dealById = new Map(deals.map((row) => [row.id, row]));

		return {
			rows: rows.map((row) => {
				const contact = row.contactId ? contactById.get(row.contactId) : null;

				return {
					id: row.id,
					kind: row.kind,
					summary: row.summary,
					quote: row.quote,
					dueHint: row.dueHint?.toISOString() ?? null,
					status: row.status,
					createdAt: row.createdAt.toISOString(),
					contact: contact
						? {
								id: contact.id,
								name: [contact.firstName, contact.lastName]
									.filter(Boolean)
									.join(" "),
							}
						: null,
					company: row.companyId
						? (companyById.get(row.companyId) ?? null)
						: null,
					deal: row.dealId ? (dealById.get(row.dealId) ?? null) : null,
				};
			}),
		};
	}

	async decide(input: FollowupDecideInput, userId: string) {
		const row = await this.db.followUpSuggestion.findUnique({
			where: { id: input.id },
		});

		if (!row || row.userId !== userId) {
			throw new NotFoundException(
				`No follow-up suggestion with id ${input.id}.`,
			);
		}

		if (row.status !== "PROPOSED" && row.status !== "SNOOZED") {
			throw new NotFoundException(
				`That suggestion was already ${row.status.toLowerCase()}.`,
			);
		}

		if (input.decision === "accept") {
			return this.accept(row, input, userId);
		}

		if (input.decision === "snooze") {
			return this.snooze(row, input);
		}

		return this.dismiss(row);
	}

	/** Once a day, at the end of the sync tick: one sweep per connected rep. */
	async enqueueDue(): Promise<{ enqueued: number }> {
		const rows = await this.db.mailboxSync.findMany({
			distinct: ["userId"],
			select: { userId: true },
		});

		for (const row of rows) {
			await this.agent.followupsDue(row.userId, "Daily follow-up sweep");
		}

		return { enqueued: rows.length };
	}

	private async accept(
		row: {
			id: string;
			contactId: string | null;
			companyId: string | null;
			dealId: string | null;
			summary: string;
			dueHint: Date | null;
		},
		input: FollowupDecideInput,
		userId: string,
	) {
		const companyId = await this.resolveCompanyId(row);
		const dueAt = input.dueAt
			? new Date(input.dueAt)
			: (row.dueHint ?? new Date(Date.now() + DEFAULT_DUE_MS));

		const activity = await this.db.activity.create({
			data: {
				type: ActivityType.TASK,
				subject: row.summary,
				occurredAt: new Date(),
				dueAt,
				companyId,
				contactId: row.contactId,
				dealId: row.dealId,
				createdById: userId,
			},
			select: { id: true, createdAt: true },
		});

		await this.stamp.touch(
			{ companyId, contactId: row.contactId, dealId: row.dealId },
			activity.createdAt,
		);

		await this.db.followUpSuggestion.update({
			where: { id: row.id },
			data: {
				status: "ACCEPTED",
				activityId: activity.id,
				decidedAt: new Date(),
			},
		});

		this.logger.log({
			message: "Follow-up accepted",
			suggestionId: row.id,
			activityId: activity.id,
		});

		return { decision: "accept" as const, activityId: activity.id };
	}

	private async snooze(row: { id: string }, input: FollowupDecideInput) {
		if (!input.dueAt) {
			throw new NotFoundException("Snoozing needs a date to come back to.");
		}

		await this.db.followUpSuggestion.update({
			where: { id: row.id },
			data: {
				status: "SNOOZED",
				dueHint: new Date(input.dueAt),
				decidedAt: new Date(),
			},
		});

		return { decision: "snooze" as const, activityId: null };
	}

	private async dismiss(row: { id: string }) {
		await this.db.followUpSuggestion.update({
			where: { id: row.id },
			data: { status: "DISMISSED", decidedAt: new Date() },
		});

		return { decision: "dismiss" as const, activityId: null };
	}

	/** A deal's suggestion is stamped with its company; a contact's with theirs. */
	private async resolveCompanyId(row: {
		contactId: string | null;
		companyId: string | null;
		dealId: string | null;
	}): Promise<string | null> {
		if (row.companyId) return row.companyId;

		if (row.dealId) {
			const deal = await this.db.deal.findUnique({
				where: { id: row.dealId },
				select: { companyId: true },
			});
			return deal?.companyId ?? null;
		}

		if (row.contactId) {
			const contact = await this.db.contact.findUnique({
				where: { id: row.contactId },
				select: { companyId: true },
			});
			return contact?.companyId ?? null;
		}

		return null;
	}
}

function unique(ids: (string | null)[]): string[] {
	return [...new Set(ids.filter((id): id is string => id !== null))];
}
