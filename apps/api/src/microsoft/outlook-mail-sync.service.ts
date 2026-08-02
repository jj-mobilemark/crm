import {
	ActivityType,
	type Db,
	EmailDirection,
	GoogleSyncStatus,
	type MailboxSyncModel as MailboxSync,
	RecordSource,
} from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { ActivityStampService } from "../crm/activity-stamp.service";
import { InjectDatabase } from "../database/database.constants";
import { snippetOf } from "../google/mime";
import { SyncStateService } from "../google/sync-state.service";
import { ScreeningHarvestService } from "../screening/screening-harvest.service";
import {
	type MatchContext,
	MicrosoftMatchService,
} from "./microsoft-match.service";
import { MicrosoftTokenService } from "./microsoft-token.service";
import { type GraphMessage, OutlookMailClient } from "./outlook-mail.client";
import { type ParsedMessage, parseGraphMessage } from "./outlook-message";

/** Ceiling on one tick, so a burst of mail cannot stretch an invocation. */
const MAX_MESSAGES_PER_TICK = 120;

/** Ceiling on delta pages per tick — the guard for baseline draining. */
const MAX_PAGES_PER_TICK = 20;

/**
 * A cursor prefixed like this is still draining the initial delta and must
 * import nothing. A plain cursor is a steady-state `@odata.deltaLink`.
 *
 * Graph mail delta has no cheap "now" token: the only way to a baseline
 * deltaLink is to walk the whole inbox once. We walk it importing nothing —
 * matching Gmail's forward-only start — and this prefix is how a half-finished
 * walk is told apart from steady state, since both use `@odata.nextLink` pages.
 */
const BASELINE_PREFIX = "baseline:";

export type OutlookMailSyncOutcome = {
	source: "outlook";
	userId: string;
	status: "synced" | "skipped" | "reconnect" | "rate-limited" | "failed";
	messagesWritten?: number;
	reason?: string;
};

/**
 * Outlook → `EmailThread`/`EmailMessage` → one projected `Activity` per thread.
 *
 * The mechanical twin of `GmailSyncService`. Graph hands full messages inline
 * on each delta page, so there is no per-message fetch; identity still comes
 * from RFC headers and the body still needs its quote trail pruned.
 */
@Injectable()
export class OutlookMailSyncService {
	private readonly logger = new Logger(OutlookMailSyncService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly mail: OutlookMailClient,
		private readonly tokens: MicrosoftTokenService,
		private readonly match: MicrosoftMatchService,
		private readonly state: SyncStateService,
		private readonly stamp: ActivityStampService,
		private readonly screening: ScreeningHarvestService,
	) {}

	async sync(row: MailboxSync): Promise<OutlookMailSyncOutcome> {
		const token = await this.tokens.accessTokenFor(row.userId, "outlook");

		if (token.outcome === "not-connected") {
			return {
				source: "outlook",
				userId: row.userId,
				status: "skipped",
				reason: token.reason,
			};
		}

		if (token.outcome === "needs-reconnect") {
			await this.state.markNeedsReconnect(row.id, token.reason);
			return {
				source: "outlook",
				userId: row.userId,
				status: "reconnect",
				reason: token.reason,
			};
		}

		await this.state.markRunning(row.id);

		// Whose mailbox this is, so a message can be classed inbound or outbound
		// and so "did the rep reply?" is answerable.
		const profile = await this.mail.profile(token.accessToken);
		if (profile.outcome !== "ok") {
			return this.handleFailure(row, profile);
		}

		const mailbox =
			profile.data.mail?.toLowerCase() ??
			profile.data.userPrincipalName?.toLowerCase() ??
			null;
		if (!mailbox) {
			await this.state.markFailed(row.id, "Graph returned no mailbox address.");
			return {
				source: "outlook",
				userId: row.userId,
				status: "failed",
				reason: "No mailbox address.",
			};
		}

		return this.drain(row, token.accessToken, mailbox);
	}

	/**
	 * Walks the delta chain for this tick.
	 *
	 * Three cursor states, told apart by the stored string:
	 *  - none → open a fresh delta; baseline, import nothing.
	 *  - `baseline:<link>` → still draining the initial walk; import nothing.
	 *  - `<deltaLink>` → steady state; import each change.
	 *
	 * Pages are followed within the tick up to the message and page budgets; the
	 * final `@odata.deltaLink` becomes the steady-state cursor.
	 */
	private async drain(
		row: MailboxSync,
		accessToken: string,
		mailbox: string,
	): Promise<OutlookMailSyncOutcome> {
		const baseline = !row.cursor || row.cursor.startsWith(BASELINE_PREFIX);
		let cursor = row.cursor?.startsWith(BASELINE_PREFIX)
			? row.cursor.slice(BASELINE_PREFIX.length)
			: (row.cursor ?? undefined);

		const context = baseline ? null : await this.loadContext();
		let written = 0;

		for (let page = 0; page < MAX_PAGES_PER_TICK; page += 1) {
			const result = await this.mail.delta(accessToken, { cursor });

			if (result.outcome === "cursor-invalid") {
				// The delta token expired — which takes a long stretch of the sync
				// not running. Forward-only: drop the cursor and re-baseline from now
				// rather than fetching the gap.
				await this.state.clearCursor(row.id, result.reason);
				return {
					source: "outlook",
					userId: row.userId,
					status: "synced",
					reason: "Delta expired; resuming from now.",
				};
			}

			if (result.outcome !== "ok") {
				return this.handleFailure(row, result);
			}

			if (!baseline && context) {
				for (const message of result.data.value ?? []) {
					if (message["@removed"]) continue;
					const stored = await this.store(row, mailbox, message, context);
					if (stored) written += 1;
				}
			}

			const next = result.data["@odata.nextLink"];
			const delta = result.data["@odata.deltaLink"];

			if (delta) {
				// Chain drained. From now on this is steady state.
				await this.state.settle(row.id, {
					cursor: delta,
					status: GoogleSyncStatus.RUNNING,
				});
				if (written > 0) {
					this.logger.log({
						message: "Outlook mail sync",
						userId: row.userId,
						messagesWritten: written,
						baseline,
					});
				}
				return {
					source: "outlook",
					userId: row.userId,
					status: "synced",
					messagesWritten: written,
				};
			}

			if (!next) break;
			cursor = next;

			// Steady state respects the message budget; baseline is capped by pages
			// alone since it writes nothing.
			if (!baseline && written >= MAX_MESSAGES_PER_TICK) {
				await this.state.settle(row.id, {
					cursor: next,
					status: GoogleSyncStatus.IDLE,
				});
				this.logger.log({
					message: "Outlook mail budget reached; continuing next tick",
					userId: row.userId,
					messagesWritten: written,
				});
				return {
					source: "outlook",
					userId: row.userId,
					status: "synced",
					messagesWritten: written,
					reason: "Message budget reached; continuing next tick.",
				};
			}
		}

		// Ran out of page budget without a deltaLink. Persist where we are so the
		// next tick resumes rather than re-walking from scratch. Baseline keeps its
		// prefix so it stays import-nothing until the walk completes.
		if (cursor) {
			await this.state.settle(row.id, {
				cursor: baseline ? `${BASELINE_PREFIX}${cursor}` : cursor,
				status: GoogleSyncStatus.IDLE,
			});
		}

		return {
			source: "outlook",
			userId: row.userId,
			status: "synced",
			messagesWritten: written,
			reason: "Page budget reached; continuing next tick.",
		};
	}

	private async loadContext(): Promise<MatchContext> {
		const [internal, suppressedDomains] = await Promise.all([
			this.match.internalIdentity(),
			this.match.suppressedDomains(),
		]);

		return {
			ourAddresses: internal.addresses,
			ourDomains: internal.domains,
			suppressedDomains,
		};
	}

	/**
	 * Store one Graph message through the same match/thread/activity path as
	 * incremental sync. Used by contact-add backfill so both writers stay one.
	 */
	async ingestMessage(
		row: MailboxSync,
		mailbox: string,
		message: GraphMessage,
		context?: MatchContext,
	): Promise<boolean> {
		const ctx = context ?? (await this.loadContext());
		return this.store(row, mailbox, message, ctx);
	}

	/** One message: match it, store it, keep its thread's projection current. */
	private async store(
		row: MailboxSync,
		mailbox: string,
		message: GraphMessage,
		context: MatchContext,
	): Promise<boolean> {
		const parsed = parseGraphMessage(message);
		if (!parsed) return false;

		// Already ingested, from this mailbox or another rep's. The unique index on
		// `rfcMessageId` is the backstop; checking first keeps the log honest.
		const existing = await this.db.emailMessage.findUnique({
			where: { rfcMessageId: parsed.rfcMessageId },
			select: { id: true },
		});
		if (existing) return false;

		const participants = [parsed.from, ...parsed.recipients];
		const outbound = parsed.from.email === mailbox;

		// The thread may already exist from an earlier message, in which case its
		// match is authoritative and the whole resolve step is skipped.
		const thread = await this.db.emailThread.findUnique({
			where: { rootMessageId: parsed.rootId },
			select: { id: true, companyId: true, contactId: true },
		});

		let companyId = thread?.companyId ?? null;
		let contactId = thread?.contactId ?? null;

		if (!thread) {
			// Two-way engagement: the rep has to have sent something. An inbound-only
			// thread is a newsletter, a recruiter or spam, and creating a company
			// from one is how a CRM fills with junk.
			const repliedTo =
				outbound || (await this.hasOutboundInThread(parsed.rootId, mailbox));

			const match = await this.match.resolve(
				{
					participants,
					allowCreate: row.autoCreate && repliedTo,
					source: RecordSource.EMAIL,
					ownerId: row.userId,
				},
				context,
			);

			companyId = match.companyId;
			contactId = match.contactId;

			if (!companyId && !contactId) {
				// Not anybody we track and not worth creating. Bodies are never
				// written — only participant metadata goes to the Screening Room.
				await this.screening.harvest({
					external: match.external,
					direction: outbound
						? EmailDirection.OUTBOUND
						: EmailDirection.INBOUND,
					subject: parsed.subject,
					seenAt: parsed.sentAt,
				});
				return false;
			}
		}

		const parsedMessage: ParsedMessage = parsed;

		const record = await this.db.emailThread.upsert({
			where: { rootMessageId: parsedMessage.rootId },
			create: {
				rootMessageId: parsedMessage.rootId,
				subject: parsedMessage.subject,
				companyId,
				contactId,
				firstMessageAt: parsedMessage.sentAt,
				lastMessageAt: parsedMessage.sentAt,
				messageCount: 0,
			},
			update: {},
			select: { id: true, firstMessageAt: true, lastMessageAt: true },
		});

		await this.db.emailMessage.create({
			data: {
				threadId: record.id,
				rfcMessageId: parsedMessage.rfcMessageId,
				syncedByUserId: row.userId,
				outlookMessageId: parsedMessage.outlookMessageId,
				direction: outbound ? EmailDirection.OUTBOUND : EmailDirection.INBOUND,
				fromEmail: parsedMessage.from.email,
				fromName: parsedMessage.from.name,
				recipients: parsedMessage.recipients,
				subject: parsedMessage.subject,
				snippet: snippetOf(parsedMessage.body),
				body: parsedMessage.body || null,
				sentAt: parsedMessage.sentAt,
			},
		});

		// Recomputed rather than incremented: messages arriving out of order would
		// otherwise leave `lastMessageAt` pointing at whichever arrived last.
		const stats = await this.db.emailMessage.aggregate({
			where: { threadId: record.id },
			_count: { _all: true },
			_min: { sentAt: true },
			_max: { sentAt: true },
		});

		const firstMessageAt = stats._min.sentAt ?? parsedMessage.sentAt;
		const lastMessageAt = stats._max.sentAt ?? parsedMessage.sentAt;

		await this.db.emailThread.update({
			where: { id: record.id },
			data: {
				messageCount: stats._count._all,
				firstMessageAt,
				lastMessageAt,
				// A thread's subject is the one it started with, not the "Re: Re:"
				// it acquired.
				...(parsedMessage.sentAt <= firstMessageAt
					? { subject: parsedMessage.subject }
					: {}),
			},
		});

		await this.project(record.id, row.userId, {
			subject: parsedMessage.subject ?? "(no subject)",
			snippet: snippetOf(parsedMessage.body),
			lastMessageAt,
			companyId,
			contactId,
		});

		return true;
	}

	/** Whether the mailbox owner has sent anything into this thread already. */
	private async hasOutboundInThread(
		rootMessageId: string,
		mailbox: string,
	): Promise<boolean> {
		const found = await this.db.emailMessage.findFirst({
			where: {
				thread: { rootMessageId },
				fromEmail: mailbox,
			},
			select: { id: true },
		});

		return found !== null;
	}

	/**
	 * One `Activity` per thread, updated as the thread grows.
	 *
	 * Not one per message: a forty-message thread would otherwise be forty
	 * timeline rows saying almost the same thing.
	 */
	private async project(
		emailThreadId: string,
		userId: string,
		summary: {
			subject: string;
			snippet: string | null;
			lastMessageAt: Date;
			companyId: string | null;
			contactId: string | null;
		},
	): Promise<void> {
		const activity = await this.db.activity.upsert({
			where: { emailThreadId },
			create: {
				type: ActivityType.EMAIL,
				subject: summary.subject,
				body: summary.snippet,
				occurredAt: summary.lastMessageAt,
				companyId: summary.companyId,
				contactId: summary.contactId,
				createdById: userId,
				emailThreadId,
				meta: { synced: true, source: "outlook" },
			},
			update: {
				body: summary.snippet,
				occurredAt: summary.lastMessageAt,
			},
			select: { createdAt: true },
		});

		await this.stamp.touch(
			{ companyId: summary.companyId, contactId: summary.contactId },
			activity.createdAt,
		);
	}

	private async handleFailure(
		row: MailboxSync,
		result: { outcome: string; reason: string; retryAfterMs?: number },
	): Promise<OutlookMailSyncOutcome> {
		if (result.outcome === "unauthorized") {
			await this.state.markNeedsReconnect(row.id, result.reason);
			return {
				source: "outlook",
				userId: row.userId,
				status: "reconnect",
				reason: result.reason,
			};
		}

		if (result.outcome === "rate-limited") {
			await this.state.markRateLimited(row.id, result.retryAfterMs ?? 60_000);
			return {
				source: "outlook",
				userId: row.userId,
				status: "rate-limited",
				reason: result.reason,
			};
		}

		await this.state.markFailed(row.id, result.reason);
		return {
			source: "outlook",
			userId: row.userId,
			status: "failed",
			reason: result.reason,
		};
	}
}
