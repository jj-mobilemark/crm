import { type Db, GoogleSyncStatus } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import {
	BACKFILL_MAX_AGE_DAYS,
	BACKFILL_MAX_PAGES,
	BACKFILL_MAX_PER_TICK,
	BACKFILL_PAGE_SIZE,
} from "./microsoft.constants";
import { MicrosoftTokenService } from "./microsoft-token.service";
import { OutlookMailClient } from "./outlook-mail.client";
import { OutlookMailSyncService } from "./outlook-mail-sync.service";

export type BackfillTickSummary = {
	attempted: number;
	done: number;
	failed: number;
	messagesWritten: number;
};

/**
 * Targeted Graph import for addresses queued when a contact is added.
 *
 * Runs at the end of a Microsoft sync tick (and after Sync now) within the
 * remaining budget. Searches each connected mailbox for that address, feeds
 * hits through the same ingest path as incremental sync, and relies on
 * `rfcMessageId` uniqueness for idempotency.
 */
@Injectable()
export class OutlookMailBackfillService {
	private readonly logger = new Logger(OutlookMailBackfillService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly mail: OutlookMailClient,
		private readonly tokens: MicrosoftTokenService,
		private readonly sync: OutlookMailSyncService,
	) {}

	/**
	 * Process up to {@link BACKFILL_MAX_PER_TICK} pending rows while
	 * `deadline` is in the future.
	 */
	async processPending(deadline: number): Promise<BackfillTickSummary> {
		const summary: BackfillTickSummary = {
			attempted: 0,
			done: 0,
			failed: 0,
			messagesWritten: 0,
		};

		const pending = await this.db.emailBackfill.findMany({
			where: { status: "PENDING" },
			orderBy: { createdAt: "asc" },
			take: BACKFILL_MAX_PER_TICK,
		});

		for (const row of pending) {
			if (Date.now() >= deadline) break;

			summary.attempted += 1;

			const claimed = await this.db.emailBackfill.updateMany({
				where: { id: row.id, status: "PENDING" },
				data: { status: "RUNNING", error: null },
			});
			if (claimed.count === 0) continue;

			try {
				const written = await this.runOne(row.address, deadline);
				summary.messagesWritten += written;

				await this.db.emailBackfill.update({
					where: { id: row.id },
					data: {
						status: "DONE",
						error: null,
						finishedAt: new Date(),
					},
				});
				summary.done += 1;
			} catch (error) {
				summary.failed += 1;
				const reason = error instanceof Error ? error.message : String(error);
				await this.db.emailBackfill.update({
					where: { id: row.id },
					data: {
						status: "FAILED",
						error: reason.slice(0, 500),
						finishedAt: new Date(),
					},
				});
				this.logger.error(
					{
						message: "Outlook mail backfill failed",
						backfillId: row.id,
					},
					error instanceof Error ? error.stack : String(error),
				);
			}
		}

		if (summary.attempted > 0) {
			this.logger.log({
				message: "Outlook mail backfill tick",
				attempted: summary.attempted,
				done: summary.done,
				failed: summary.failed,
				messagesWritten: summary.messagesWritten,
			});
		}

		return summary;
	}

	/**
	 * Search every connected Outlook mailbox for this address and ingest
	 * matching messages newer than {@link BACKFILL_MAX_AGE_DAYS}.
	 */
	private async runOne(address: string, deadline: number): Promise<number> {
		const mailboxes = await this.db.mailboxSync.findMany({
			where: {
				source: "outlook",
				status: {
					notIn: [GoogleSyncStatus.NEEDS_RECONNECT],
				},
			},
		});

		const cutoff = new Date();
		cutoff.setUTCDate(cutoff.getUTCDate() - BACKFILL_MAX_AGE_DAYS);

		let written = 0;

		for (const row of mailboxes) {
			if (Date.now() >= deadline) break;

			const token = await this.tokens.accessTokenFor(row.userId, "outlook");
			if (token.outcome !== "ok") continue;

			const profile = await this.mail.profile(token.accessToken);
			if (profile.outcome !== "ok") continue;

			const mailbox =
				profile.data.mail?.toLowerCase() ??
				profile.data.userPrincipalName?.toLowerCase() ??
				null;
			if (!mailbox) continue;

			let cursor: string | undefined;
			for (let page = 0; page < BACKFILL_MAX_PAGES; page += 1) {
				if (Date.now() >= deadline) break;

				const result = await this.mail.searchByParticipant(
					token.accessToken,
					address,
					{ top: BACKFILL_PAGE_SIZE, cursor },
				);

				if (result.outcome === "rate-limited") {
					throw new Error(
						`Graph rate-limited during backfill: ${result.reason}`,
					);
				}
				if (result.outcome === "unauthorized") {
					throw new Error(
						`Mailbox needs reconnect during backfill: ${result.reason}`,
					);
				}
				if (result.outcome !== "ok") {
					throw new Error(result.reason);
				}

				for (const message of result.data.value ?? []) {
					if (message["@removed"]) continue;

					const received = message.receivedDateTime ?? message.sentDateTime;
					if (received) {
						const at = new Date(received);
						if (!Number.isNaN(at.getTime()) && at < cutoff) continue;
					}

					const stored = await this.sync.ingestMessage(row, mailbox, message);
					if (stored) written += 1;
				}

				const next = result.data["@odata.nextLink"];
				if (!next) break;
				cursor = next;
			}
		}

		return written;
	}
}
