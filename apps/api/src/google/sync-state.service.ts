import {
	type Db,
	GoogleSyncStatus,
	type MailboxSyncModel as MailboxSync,
} from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
/**
 * The cursor store.
 *
 * Every mutation a sync makes to its own bookkeeping goes through here, so
 * "what state can a sync row be in" is answerable by reading one file rather
 * than by grepping two sync services for `update`.
 *
 * `source` is a plain string (`gmail` / `calendar` / `outlook` /
 * `outlook-calendar`) so Google and Microsoft share this store without a
 * shared SyncSource union that would couple the modules.
 */
@Injectable()
export class SyncStateService {
	private readonly logger = new Logger(SyncStateService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	async get(userId: string, source: string): Promise<MailboxSync | null> {
		return this.db.mailboxSync.findUnique({
			where: { userId_source: { userId, source } },
		});
	}

	async listForUser(userId: string): Promise<MailboxSync[]> {
		return this.db.mailboxSync.findMany({ where: { userId } });
	}

	/**
	 * The rows a cron tick should attempt.
	 *
	 * Excludes `NEEDS_RECONNECT` — that state is terminal until a human acts, and
	 * retrying it every five minutes would be a pointless call forever. Also
	 * excludes anything inside its rate-limit backoff.
	 *
	 * Pass `sources` so Google and Microsoft ticks do not steal each other's
	 * rows — `MailboxSync.source` is a plain string shared by both providers.
	 */
	async due(now: Date, sources?: readonly string[]): Promise<MailboxSync[]> {
		return this.db.mailboxSync.findMany({
			where: {
				status: { notIn: [GoogleSyncStatus.NEEDS_RECONNECT] },
				OR: [{ retryAfter: null }, { retryAfter: { lte: now } }],
				...(sources ? { source: { in: [...sources] } } : {}),
			},
			// Least-recently-synced first, so one busy mailbox cannot starve the
			// rest when a tick runs out of budget. A never-synced row sorts first.
			orderBy: [{ lastSyncedAt: { sort: "asc", nulls: "first" } }],
		});
	}

	/** Creates the row when a source is first connected. Idempotent. */
	async ensure(
		userId: string,
		source: string,
		options: { autoCreate: boolean },
	): Promise<MailboxSync> {
		return this.db.mailboxSync.upsert({
			where: { userId_source: { userId, source } },
			create: {
				userId,
				source,
				// No cursor yet. The first pass records where "now" is and imports
				// nothing — sync is forward-only.
				status: GoogleSyncStatus.IDLE,
				autoCreate: options.autoCreate,
			},
			// Reconnecting keeps the cursor: re-consenting must not rewind a
			// mailbox. It *does* clear the error and lift a NEEDS_RECONNECT, which
			// is the whole point of reconnecting.
			update: {
				status: GoogleSyncStatus.IDLE,
				lastError: null,
				retryAfter: null,
			},
		});
	}

	async markRunning(id: string): Promise<void> {
		await this.db.mailboxSync.update({
			where: { id },
			data: { status: GoogleSyncStatus.RUNNING, lastError: null },
		});
	}

	/** A clean pass: advance the cursor, clear the error, stamp the time. */
	async settle(
		id: string,
		update: {
			cursor?: string | null;
			status: GoogleSyncStatus;
		},
	): Promise<void> {
		await this.db.mailboxSync.update({
			where: { id },
			data: {
				...update,
				lastSyncedAt: new Date(),
				lastError: null,
				retryAfter: null,
			},
		});
	}

	/**
	 * The cursor is gone (Gmail 404 / Calendar 410).
	 *
	 * Drops it so the next pass starts from now. Forward-only means the gap is
	 * not fetched — reaching here at all takes roughly a week of the sync not
	 * running, so it is warned about rather than quietly healed.
	 */
	async clearCursor(id: string, reason: string): Promise<void> {
		this.logger.warn({
			message: "Sync cursor invalidated — resuming from now",
			syncId: id,
			reason,
		});

		await this.db.mailboxSync.update({
			where: { id },
			data: {
				cursor: null,
				status: GoogleSyncStatus.IDLE,
				lastError: null,
			},
		});
	}

	async markNeedsReconnect(id: string, reason: string): Promise<void> {
		await this.db.mailboxSync.update({
			where: { id },
			data: {
				status: GoogleSyncStatus.NEEDS_RECONNECT,
				lastError: reason,
				retryAfter: null,
			},
		});
	}

	async markRateLimited(id: string, retryAfterMs: number): Promise<void> {
		await this.db.mailboxSync.update({
			where: { id },
			data: {
				status: GoogleSyncStatus.IDLE,
				retryAfter: new Date(Date.now() + retryAfterMs),
			},
		});
	}

	async markFailed(id: string, reason: string): Promise<void> {
		await this.db.mailboxSync.update({
			where: { id },
			data: { status: GoogleSyncStatus.FAILED, lastError: reason },
		});
	}

	async setAutoCreate(
		userId: string,
		source: string,
		enabled: boolean,
	): Promise<void> {
		await this.db.mailboxSync.updateMany({
			where: { userId, source },
			data: { autoCreate: enabled },
		});
	}

	async remove(userId: string, source?: string): Promise<void> {
		await this.db.mailboxSync.deleteMany({
			where: { userId, ...(source ? { source } : {}) },
		});
	}
}
