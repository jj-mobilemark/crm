import {
	ActivityType,
	type Db,
	DEFAULT_FOLLOWUP_PREFS,
	type FollowupPrefs,
	floatFirstKindRank,
	kindAllowedForScope,
	lookbackDays,
} from "@crm/db";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { ActivityStampService } from "../crm/activity-stamp.service";
import { toCents } from "../crm/values";
import { InjectDatabase } from "../database/database.constants";
import type {
	FollowupDecideInput,
	FollowupPrefsInput,
} from "./followups.contracts";

/** A day, for the default due date a bare "accept" without a date gets. */
const DEFAULT_DUE_MS = 3 * 24 * 60 * 60 * 1000;

type EvidenceItem = { sentAt?: string };

/**
 * The per-rep Follow-ups panel — the API's half of Phase 5.
 *
 * What the agent decided lives in `FollowUpSuggestion`, written by the
 * `propose_followups` tool. This service only ever reads a rep's own rows and
 * turns an accepted one into a real `Activity` TASK — it never proposes
 * anything itself, and it never sees another rep's queue. Priority prefs only
 * filter and reorder what is already proposed.
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
		const prefs = await this.prefs(userId);
		const cutoff = new Date(
			now.getTime() - lookbackDays(prefs.lookback) * 86_400_000,
		);

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

		const dealIds = unique(rows.map((row) => row.dealId));
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
				where: { id: { in: dealIds } },
				select: {
					id: true,
					name: true,
					stage: true,
					ownerId: true,
					activities: {
						where: { createdById: userId },
						select: { id: true },
						take: 1,
					},
				},
			}),
		]);

		const contactById = new Map(contacts.map((row) => [row.id, row]));
		const companyById = new Map(companies.map((row) => [row.id, row]));
		const dealById = new Map(deals.map((row) => [row.id, row]));

		const filtered = rows
			.filter((row) => kindAllowedForScope(prefs.scope, row.kind))
			.filter((row) => withinLookback(row, cutoff))
			.filter((row) => {
				if (!row.dealId) return true;
				const deal = dealById.get(row.dealId);
				if (!deal) return false;
				if (prefs.scope === "owned" || prefs.scope === "mail") {
					return deal.ownerId === userId;
				}
				// shared: owned by me, or I have logged activity on it
				return deal.ownerId === userId || deal.activities.length > 0;
			})
			.toSorted((a, b) => {
				const rank =
					floatFirstKindRank(prefs.floatFirst, a.kind) -
					floatFirstKindRank(prefs.floatFirst, b.kind);
				if (rank !== 0) return rank;
				const aDue = a.dueHint?.getTime() ?? Number.POSITIVE_INFINITY;
				const bDue = b.dueHint?.getTime() ?? Number.POSITIVE_INFINITY;
				if (aDue !== bDue) return aDue - bDue;
				return b.createdAt.getTime() - a.createdAt.getTime();
			});

		return {
			prefs,
			rows: filtered.map((row) => {
				const contact = row.contactId ? contactById.get(row.contactId) : null;
				const deal = row.dealId ? dealById.get(row.dealId) : null;

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
					deal: deal
						? { id: deal.id, name: deal.name, stage: deal.stage }
						: null,
				};
			}),
		};
	}

	async prefs(userId: string): Promise<FollowupPrefs> {
		const row = await this.db.followUpPreference.findUnique({
			where: { userId },
			select: { floatFirst: true, lookback: true, scope: true },
		});

		if (!row) return { ...DEFAULT_FOLLOWUP_PREFS };

		return {
			floatFirst: asEnum(row.floatFirst, DEFAULT_FOLLOWUP_PREFS.floatFirst, [
				"balanced",
				"commitments",
				"replies",
				"deal-risk",
			] as const),
			lookback: asEnum(row.lookback, DEFAULT_FOLLOWUP_PREFS.lookback, [
				"7d",
				"30d",
				"90d",
			] as const),
			scope: asEnum(row.scope, DEFAULT_FOLLOWUP_PREFS.scope, [
				"owned",
				"shared",
				"mail",
			] as const),
		};
	}

	async updatePrefs(userId: string, input: FollowupPrefsInput) {
		await this.db.followUpPreference.upsert({
			where: { userId },
			create: {
				userId,
				floatFirst: input.floatFirst,
				lookback: input.lookback,
				scope: input.scope,
			},
			update: {
				floatFirst: input.floatFirst,
				lookback: input.lookback,
				scope: input.scope,
			},
		});

		return this.prefs(userId);
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

	/**
	 * Active deals for the Follow-ups deals lane, scoped by the same prefs as
	 * suggestions. `shared` includes deals the rep owns or has logged activity
	 * on (there is no deal-membership table).
	 */
	async pipeline(userId: string) {
		const prefs = await this.prefs(userId);

		const where =
			prefs.scope === "shared"
				? {
						closedAt: null,
						OR: [
							{ ownerId: userId },
							{ activities: { some: { createdById: userId } } },
						],
					}
				: { closedAt: null, ownerId: userId };

		const rows = await this.db.deal.findMany({
			where,
			orderBy: [{ lastActivityAt: { sort: "asc", nulls: "first" } }],
			take: 8,
			select: {
				id: true,
				name: true,
				stage: true,
				amount: true,
				currency: true,
				lastActivityAt: true,
				company: { select: { id: true, name: true } },
			},
		});

		return {
			prefs,
			rows: rows.map((deal) => ({
				id: deal.id,
				name: deal.name,
				stage: deal.stage,
				amountCents: toCents(deal.amount),
				currency: deal.currency,
				lastActivityAt: deal.lastActivityAt?.toISOString() ?? null,
				company: deal.company,
			})),
		};
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

function asEnum<T extends string>(
	value: string,
	fallback: T,
	allowed: readonly T[],
): T {
	return (allowed as readonly string[]).includes(value)
		? (value as T)
		: fallback;
}

/**
 * Keep suggestions whose newest cited message (or createdAt) falls inside the
 * lookback window. Snoozed rows that just came due stay visible even if older.
 */
function withinLookback(
	row: {
		status: string;
		createdAt: Date;
		evidence: unknown;
	},
	cutoff: Date,
): boolean {
	if (row.status === "SNOOZED") return true;

	const evidence = Array.isArray(row.evidence)
		? (row.evidence as EvidenceItem[])
		: [];
	const newestEvidence = evidence.reduce<number | null>((newest, item) => {
		if (!item.sentAt) return newest;
		const time = Date.parse(item.sentAt);
		if (Number.isNaN(time)) return newest;
		return newest === null ? time : Math.max(newest, time);
	}, null);

	if (newestEvidence !== null) {
		return newestEvidence >= cutoff.getTime();
	}

	return row.createdAt.getTime() >= cutoff.getTime();
}
