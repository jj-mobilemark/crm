import { type Db, GoogleSyncStatus } from "@crm/db";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { normalizeDomain } from "../companies/domain";
import { ActivityStampService } from "../crm/activity-stamp.service";
import { InjectDatabase } from "../database/database.constants";
import {
	SCOPE_FOR_SOURCE,
	SYNC_SOURCES,
	type SyncSource,
} from "./google.constants";
import { GoogleMatchService } from "./google-match.service";
import { GoogleTokenService } from "./google-token.service";
import { SyncStateService } from "./sync-state.service";

export type SourceStatus = {
	source: SyncSource;
	connected: boolean;
	status: GoogleSyncStatus | null;
	lastSyncedAt: string | null;
	lastError: string | null;
	autoCreate: boolean;
};

export type ConnectionStatus = {
	/** Whether Google issued a refresh token. False means reconnect. */
	hasRefreshToken: boolean;
	sources: SourceStatus[];
};

/**
 * Everything the settings page asks about a rep's Google connection.
 *
 * Connection state is read from `Account.scope` rather than kept in a column of
 * our own: the grant is the truth, and a boolean we maintain alongside it is a
 * boolean that will eventually disagree with it.
 */
@Injectable()
export class GoogleConnectionService {
	private readonly logger = new Logger(GoogleConnectionService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly tokens: GoogleTokenService,
		private readonly state: SyncStateService,
		private readonly match: GoogleMatchService,
		private readonly stamp: ActivityStampService,
	) {}

	async status(userId: string): Promise<ConnectionStatus> {
		// Reconcile first: the grant is the source of truth, and the sync rows are
		// derived from it. Doing this here rather than in an OAuth-callback handler
		// means the settings page is correct the moment it loads, with no
		// coordination between the redirect and a mutation.
		await this.onConnected(userId);

		const [granted, rows, hasRefreshToken] = await Promise.all([
			this.tokens.grantedScopes(userId),
			this.state.listForUser(userId),
			this.tokens.hasRefreshToken(userId),
		]);

		const bySource = new Map(rows.map((row) => [row.source, row]));

		const sources = SYNC_SOURCES.map((source): SourceStatus => {
			const row = bySource.get(source);
			const connected = granted.includes(SCOPE_FOR_SOURCE[source]);

			return {
				source,
				connected,
				status: row?.status ?? null,
				lastSyncedAt: row?.lastSyncedAt?.toISOString() ?? null,
				lastError: row?.lastError ?? null,
				autoCreate: row?.autoCreate ?? false,
			};
		});

		return { hasRefreshToken, sources };
	}

	/**
	 * Makes the sync rows match what Google has actually granted.
	 *
	 * Idempotent and safe to call repeatedly — `ensure` keeps the cursor of a
	 * mailbox already syncing. Called from `status` and from the cron\'s
	 * reconcile step, so a rep who grants the scopes and then closes the tab
	 * still gets synced without ever loading the settings page again.
	 */
	async onConnected(userId: string): Promise<void> {
		const [granted, existing] = await Promise.all([
			this.tokens.grantedScopes(userId),
			this.state.listForUser(userId),
		]);

		const known = new Set(existing.map((row) => row.source));

		const added: string[] = [];

		for (const source of SYNC_SOURCES) {
			if (!granted.includes(SCOPE_FOR_SOURCE[source])) continue;
			if (known.has(source)) continue;

			await this.state.ensure(userId, source, {
				// Meetings are unambiguous, so calendar auto-creates from the start.
				// Gmail is opt-in: the first week of mailbox auto-creation is where a
				// bad rule shows up, and that should be a deliberate choice.
				autoCreate: source === "calendar",
			});

			added.push(source);
		}

		if (added.length > 0) {
			this.logger.log({ message: "Google connected", userId, sources: added });
		}
	}

	/** Every user whose grant covers a source but who has no sync row yet. */
	async reconcileAll(): Promise<void> {
		const accounts = await this.db.account.findMany({
			where: {
				providerId: "google",
				OR: SYNC_SOURCES.map((source) => ({
					scope: { contains: SCOPE_FOR_SOURCE[source] },
				})),
			},
			select: { userId: true },
		});

		for (const account of new Set(accounts.map((row) => row.userId))) {
			await this.onConnected(account);
		}
	}

	/**
	 * Deletes everything this user's mailbox put into the CRM, and re-imports
	 * from scratch.
	 *
	 * Deliberately *not* a "disconnect". Mailbox access is a condition of having
	 * an account here, so there is no supported state where a signed-in rep is
	 * not syncing — and a local disconnect could not create one anyway: the grant
	 * would still be there, and the next reconcile would rebuild the rows it had
	 * just deleted. Naming it for what it does avoids a button that appears to
	 * work and silently undoes itself.
	 *
	 * The real exit is `revoke`, which ends the grant and therefore the account's
	 * access to the CRM.
	 */
	async purgeSyncedData(userId: string): Promise<{ purged: number }> {
		// Cascades take the messages, attendees and projected activities with
		// them, which is the point: "delete my mail from the CRM" should not need
		// a migration to answer.
		const [threads, events] = await this.db.$transaction([
			this.db.emailThread.deleteMany({
				where: { messages: { some: { syncedByUserId: userId } } },
			}),
			this.db.calendarEvent.deleteMany({ where: { syncedByUserId: userId } }),
		]);

		// Those cascades took activities with them, so every stamp they were the
		// high-water mark for is now overstated. `touch` cannot fix that — it only
		// ever raises — so the stamps are rebuilt.
		await this.stamp.recomputeAll();

		const purged = threads.count + events.count;

		this.logger.log({ message: "Synced data purged", userId, purged });

		return { purged };
	}

	/** The explicit hard revoke. Kills sign-in access too — see the plan §3.4. */
	async revoke(userId: string): Promise<{ revoked: boolean }> {
		// Only Google sources — Outlook rows share the same table.
		for (const source of SYNC_SOURCES) {
			await this.state.remove(userId, source);
		}
		const revoked = await this.tokens.revoke(userId);
		return { revoked };
	}

	async setAutoCreate(
		userId: string,
		source: SyncSource,
		enabled: boolean,
	): Promise<void> {
		const row = await this.state.get(userId, source);
		if (!row) {
			throw new NotFoundException(`${source} is not connected.`);
		}

		await this.state.setAutoCreate(userId, source, enabled);
	}

	/**
	 * Marks a domain as "not a customer".
	 *
	 * Optionally deletes what it already matched, because the reason someone
	 * presses this is that a vendor's domain is sitting on a timeline right now.
	 */
	async suppressDomain(
		domain: string,
		options: { reason?: string; purge: boolean },
	): Promise<{ domain: string; purged: number }> {
		const normalised = normalizeDomain(domain);
		if (!normalised) {
			throw new NotFoundException(`"${domain}" is not a domain.`);
		}

		const ours = await this.match.internalIdentity();
		if (ours.domains.has(normalised)) {
			throw new NotFoundException(
				"That is our own domain — it is already excluded.",
			);
		}

		await this.db.suppressedDomain.upsert({
			where: { domain: normalised },
			create: { domain: normalised, reason: options.reason ?? null },
			update: { reason: options.reason ?? null },
		});

		if (!options.purge) return { domain: normalised, purged: 0 };

		const company = await this.db.company.findUnique({
			where: { domain: normalised },
			select: { id: true },
		});

		if (!company) return { domain: normalised, purged: 0 };

		const [threads, events] = await this.db.$transaction([
			this.db.emailThread.deleteMany({ where: { companyId: company.id } }),
			this.db.calendarEvent.deleteMany({ where: { companyId: company.id } }),
		]);

		await this.stamp.recomputeAll();

		this.logger.log({
			message: "Domain suppressed",
			domain: normalised,
			purged: threads.count + events.count,
		});

		return { domain: normalised, purged: threads.count + events.count };
	}
}
