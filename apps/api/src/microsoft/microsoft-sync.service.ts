import { Injectable, Logger } from "@nestjs/common";
import { SyncStateService } from "../google/sync-state.service";
import { SYNC_SOURCES, type SyncSource } from "./microsoft.constants";
import { MicrosoftConnectionService } from "./microsoft-connection.service";
import { OutlookCalendarSyncService } from "./outlook-calendar-sync.service";
import { OutlookMailSyncService } from "./outlook-mail-sync.service";

/**
 * How long a tick may run.
 *
 * A cron that runs every five minutes must finish well inside five minutes or
 * ticks overlap. The budget is checked between accounts, so one slow mailbox
 * delays the next tick rather than being cut off mid-write.
 */
const TICK_BUDGET_MS = 60_000;

export type TickSummary = {
	attempted: number;
	synced: number;
	skipped: number;
	failed: number;
	durationMs: number;
};

/**
 * Runs the due Microsoft syncs.
 *
 * The twin of `GoogleSyncService`. State lives in the shared `MailboxSync`
 * table and is scoped to the Outlook sources, so a Microsoft tick never touches
 * a Google row and vice versa. The cron is the scheduler.
 */
@Injectable()
export class MicrosoftSyncService {
	private readonly logger = new Logger(MicrosoftSyncService.name);

	constructor(
		private readonly state: SyncStateService,
		private readonly calendar: OutlookCalendarSyncService,
		private readonly mail: OutlookMailSyncService,
		private readonly connections: MicrosoftConnectionService,
	) {}

	/** One cron tick: every account that is due, until the budget runs out. */
	async runDue(): Promise<TickSummary> {
		const startedAt = Date.now();
		const summary: TickSummary = {
			attempted: 0,
			synced: 0,
			skipped: 0,
			failed: 0,
			durationMs: 0,
		};

		// Pick up anyone who granted the scopes but has no sync row yet — a rep who
		// connected and closed the tab never triggers anything else.
		await this.connections.reconcileAll();

		// Scoped to the Outlook sources so this tick never steals a Google row.
		const due = await this.state.due(new Date(), SYNC_SOURCES);

		for (const row of due) {
			if (Date.now() - startedAt > TICK_BUDGET_MS) {
				this.logger.log({
					message: "Microsoft sync tick budget reached",
					remaining: due.length - summary.attempted,
				});
				break;
			}

			summary.attempted += 1;

			try {
				const outcome = await this.runOne(row.userId, row.source as SyncSource);

				if (outcome === null || outcome.status === "skipped") {
					summary.skipped += 1;
				} else if (
					outcome.status === "failed" ||
					outcome.status === "reconnect"
				) {
					summary.failed += 1;
				} else {
					summary.synced += 1;
				}
			} catch (error) {
				summary.failed += 1;
				// One account's crash must not abandon the rest of the tick.
				await this.state.markFailed(
					row.id,
					error instanceof Error ? error.message : String(error),
				);
				this.logger.error(
					{
						message: "Microsoft sync threw",
						userId: row.userId,
						source: row.source,
					},
					error instanceof Error ? error.stack : String(error),
				);
			}
		}

		summary.durationMs = Date.now() - startedAt;

		this.logger.log({
			message: "Microsoft sync tick",
			attempted: summary.attempted,
			synced: summary.synced,
			skipped: summary.skipped,
			failed: summary.failed,
			durationMs: summary.durationMs,
		});

		return summary;
	}

	/** One account, one source. Also the path `microsoft.syncNow` takes. */
	async runOne(userId: string, source: SyncSource) {
		const row = await this.state.get(userId, source);
		if (!row) return null;

		return source === "outlook-calendar"
			? this.calendar.sync(row)
			: this.mail.sync(row);
	}

	/** Every source for one user, for the "Sync now" button. */
	async runForUser(userId: string): Promise<void> {
		for (const source of SYNC_SOURCES) {
			await this.runOne(userId, source);
		}
	}
}
