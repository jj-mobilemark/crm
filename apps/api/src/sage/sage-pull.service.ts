import { type Db, DealStage, RecordSource } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import {
	DEAL_CHANGE_SELECT,
	DealChangeRecorder,
} from "../crm/deal-change.service";
import { InjectDatabase } from "../database/database.constants";
import {
	countMappableContacts,
	maxNumericId,
	sageDate,
} from "./sage-backfill.util";
import { withSageSession } from "./sage-session";
import { SageSoapClient } from "./sage-soap.client";
import {
	SAGE_INCREMENTAL_OVERLAP_MS,
	SAGE_MAX_BACKFILL_PAGES,
	SAGE_PAGE_DELAY_MS,
	SAGE_TEST_NAME_PREDICATE,
	SAGE_TEST_OPPORTUNITY_COMPANY_ID,
	SAGE_UPDATED_COLUMN,
} from "./sage.constants";
import {
	emailForAcctMgr,
	emailForSageUser,
	isPushEcho,
	mapCompanyTree,
	mapContact,
	mapOpportunity,
	type MappedCompany,
	type MappedContact,
	type MappedOpportunity,
	SAGE_USER_EMAILS,
} from "./sage.mappings";
import { ensureSageUsers } from "./sage-users";
import type { SageCompanyTree } from "./sage-xml";

/** Fallback owner when Sage assigneduserid is unmapped (Ken — Sage id 27). */
const FALLBACK_OWNER_EMAIL = "ken@mobilemark.com";

export type SageOutcome =
	| "ok"
	| "not-configured"
	| "auth-failed"
	| "failed"
	| "busy";

export type SageTestSliceSummary = {
	outcome: SageOutcome;
	reason?: string;
	companiesFetched: number;
	companiesUpserted: number;
	contactsUpserted: number;
	dealsUpserted: number;
	dealContactsLinked: number;
	snapshotsWritten: number;
	skipped: number;
};

export type SageBackfillOptions = {
	/** Fetch + snapshot + map + count, but write no core Company/Contact/Deal. */
	dryRun?: boolean;
	/** Stop after this many companies — the canary lever (e.g. 200). */
	maxCompanies?: number;
};

export type SageBackfillSummary = {
	outcome: SageOutcome;
	reason?: string;
	dryRun: boolean;
	/** Company pages walked (query + next). */
	pages: number;
	companiesFetched: number;
	companiesUpserted: number;
	contactsUpserted: number;
	dealsFetched: number;
	dealsUpserted: number;
	dealContactsLinked: number;
	snapshotsWritten: number;
	skipped: number;
};

/**
 * Sage CRM pull — test-slice first (see `docs/plans/sage-crm-sync.md` 7.4a).
 *
 * Mechanical only: SOAP -> map -> Prisma upsert + `SageRecordSnapshot`. No
 * enrichment, no agent triggers. One in-process lock so two callers never hold
 * two Sage sessions (a second logon kicks the first).
 */
@Injectable()
export class SagePullService {
	private readonly logger = new Logger(SagePullService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly soap: SageSoapClient,
		private readonly dealChanges: DealChangeRecorder,
	) {}

	/**
	 * Import the Mobile Mark test companies, nested people, and opportunities.
	 *
	 * Bounded predicate — ~8 companies / ~4 deals on company 24. Runs inside the
	 * one global Sage session (advisory lock), which `logoff`s for us.
	 */
	async importTestSlice(): Promise<SageTestSliceSummary> {
		if (!this.soap.isConfigured()) {
			return emptySummary(
				"not-configured",
				"Sage SOAP is not configured.",
			);
		}

		const ran = await withSageSession(this.db, this.soap, () =>
			this.runTestSlice(),
		);
		if (ran.outcome === "busy") {
			return emptySummary("busy", "A Sage sync is already running.");
		}
		return ran.value;
	}

	private async runTestSlice(): Promise<SageTestSliceSummary> {
		const summary: SageTestSliceSummary = {
			outcome: "ok",
			companiesFetched: 0,
			companiesUpserted: 0,
			contactsUpserted: 0,
			dealsUpserted: 0,
			dealContactsLinked: 0,
			snapshotsWritten: 0,
			skipped: 0,
		};

		try {
			const predicate = `${SAGE_TEST_NAME_PREDICATE} AND comp_deleted IS NULL`;
			const fetched = await this.soap.queryAllCompanies(predicate);
			if (fetched.outcome !== "ok") {
				summary.outcome = fetched.outcome;
				summary.reason = fetched.reason;
				return summary;
			}

			// Guarantee company 24 (has opportunities) is in the slice even if
			// the name filter somehow misses it.
			const byId = new Map(
				fetched.data.map((tree) => [tree.company.companyid, tree]),
			);
			if (!byId.has(SAGE_TEST_OPPORTUNITY_COMPANY_ID)) {
				const forced = await this.soap.queryAllCompanies(
					`comp_companyid = ${SAGE_TEST_OPPORTUNITY_COMPANY_ID} AND comp_deleted IS NULL`,
				);
				if (forced.outcome === "ok") {
					for (const tree of forced.data) {
						byId.set(tree.company.companyid, tree);
					}
				}
			}

			const trees = [...byId.values()];
			summary.companiesFetched = trees.length;

			// Domains already claimed by ANY company — used to avoid unique
			// collisions across the near-duplicate Mobile Mark rows.
			const takenDomains = await this.loadTakenDomains();
			const ownerByEmail = await this.loadOwnerCache();
			const companyBySageId = new Map<string, string>();

			for (const tree of trees) {
				const result = await this.upsertCompanyTree(tree, takenDomains, ownerByEmail);
				summary.companiesUpserted += result.company ? 1 : 0;
				summary.contactsUpserted += result.contacts;
				summary.snapshotsWritten += result.snapshots;
				summary.skipped += result.skipped;
				if (result.localCompanyId && result.sageCrmCompanyId) {
					companyBySageId.set(
						result.sageCrmCompanyId,
						result.localCompanyId,
					);
				}
			}

			const oppResult = await this.importOpportunities(companyBySageId);
			if (oppResult.outcome !== "ok") {
				summary.outcome = oppResult.outcome;
				summary.reason = oppResult.reason;
				return summary;
			}
			summary.dealsUpserted = oppResult.dealsUpserted;
			summary.dealContactsLinked = oppResult.dealContactsLinked;
			summary.snapshotsWritten += oppResult.snapshotsWritten;
			summary.skipped += oppResult.skipped;

			this.logger.log({
				message: "Sage test-slice import finished",
				companiesFetched: summary.companiesFetched,
				companiesUpserted: summary.companiesUpserted,
				contactsUpserted: summary.contactsUpserted,
				dealsUpserted: summary.dealsUpserted,
				dealContactsLinked: summary.dealContactsLinked,
				snapshotsWritten: summary.snapshotsWritten,
				skipped: summary.skipped,
			});

			return summary;
		} catch (error) {
			const reason =
				error instanceof Error ? error.message : String(error);
			this.logger.error(
				{ message: "Sage test-slice import failed", reason },
				error instanceof Error ? error.stack : String(error),
			);
			summary.outcome = "failed";
			summary.reason = reason;
			return summary;
		}
	}

	private async importOpportunities(
		companyBySageId: Map<string, string>,
	): Promise<{
		outcome: SageTestSliceSummary["outcome"];
		reason?: string;
		dealsUpserted: number;
		dealContactsLinked: number;
		snapshotsWritten: number;
		skipped: number;
	}> {
		const empty = {
			outcome: "ok" as const,
			dealsUpserted: 0,
			dealContactsLinked: 0,
			snapshotsWritten: 0,
			skipped: 0,
		};

		const sageCompanyIds = [...companyBySageId.keys()];
		if (sageCompanyIds.length === 0) return empty;

		// Prefer the full slice; always include company 24.
		const idList = sageCompanyIds.includes(SAGE_TEST_OPPORTUNITY_COMPANY_ID)
			? sageCompanyIds
			: [...sageCompanyIds, SAGE_TEST_OPPORTUNITY_COMPANY_ID];
		const predicate =
			`oppo_primarycompanyid IN (${idList.join(",")})` +
			` AND oppo_deleted IS NULL`;

		const fetched = await this.soap.queryAllRecords(
			"opportunity",
			predicate,
		);
		if (fetched.outcome !== "ok") {
			return {
				...empty,
				outcome: fetched.outcome,
				reason: fetched.reason,
			};
		}

		const fallbackOwnerId = await this.resolveFallbackOwnerId();
		if (!fallbackOwnerId) {
			this.logger.warn({
				message:
					"No local User for deal owner fallback — skipping opportunities",
			});
			return { ...empty, skipped: fetched.data.length };
		}

		let dealsUpserted = 0;
		let dealContactsLinked = 0;
		let snapshotsWritten = 0;
		let skipped = 0;

		for (const record of fetched.data) {
			const mapped = mapOpportunity(record);
			if (!mapped) {
				skipped += 1;
				continue;
			}

			snapshotsWritten += await this.writeSnapshot(
				"opportunity",
				mapped.sageCrmOpportunityId,
				record,
			);

			const companyId = companyBySageId.get(mapped.sageCrmCompanyId);
			if (!companyId) {
				skipped += 1;
				continue;
			}

			const ownerId =
				(await this.resolveOwnerId(mapped.sageAssignedUserId)) ??
				fallbackOwnerId;

			const dealId = await this.upsertDeal(mapped, companyId, ownerId);
			if (!dealId) {
				skipped += 1;
				continue;
			}
			dealsUpserted += 1;

			if (mapped.sageCrmPrimaryPersonId) {
				const linked = await this.linkPrimaryDealContact(
					dealId,
					mapped.sageCrmPrimaryPersonId,
				);
				if (linked) dealContactsLinked += 1;
			}
		}

		return {
			outcome: "ok",
			dealsUpserted,
			dealContactsLinked,
			snapshotsWritten,
			skipped,
		};
	}

	private async upsertDeal(
		mapped: MappedOpportunity,
		companyId: string,
		ownerId: string,
	): Promise<string | null> {
		const existing = await this.db.deal.findUnique({
			where: { sageCrmOpportunityId: mapped.sageCrmOpportunityId },
			select: {
				id: true,
				sagePushedAt: true,
				...DEAL_CHANGE_SELECT,
			},
		});

		const fields = {
			name: mapped.name,
			companyId,
			ownerId,
			amount: mapped.amount,
			weightedAmount: mapped.weightedAmount,
			probability: mapped.probability,
			currency: mapped.currency,
			stage: mapped.stage,
			sageStage: mapped.sageStage,
			sageStatus: mapped.sageStatus,
			dealType: mapped.dealType,
			expectedCloseDate: mapped.expectedCloseDate,
			// Real Sage close date; if a closed deal has none, fall back to the
			// forecast close then the open date rather than stamping "now"
			// (which would bunch every dateless deal into the import month).
			closedAt: resolvedClosedAt(mapped),
			// The deal's true creation date is Sage `opened`, not our import time.
			// `undefined` leaves the DB default (now) when Sage has neither.
			createdAt: mapped.openedAt ?? undefined,
			sageUpdatedAt: mapped.sageUpdatedAt,
		};

		if (existing) {
			// Our own push coming back — keep local mapped fields, stamp cursor.
			// Do not write DealFieldChange: the app already logged the local edit.
			if (isPushEcho(mapped.sageUpdatedAt, existing.sagePushedAt)) {
				await this.db.deal.update({
					where: { id: existing.id },
					data: { sageUpdatedAt: mapped.sageUpdatedAt },
				});
				return existing.id;
			}
			const stageChanged = existing.stage !== mapped.stage;
			await this.db.deal.update({
				where: { id: existing.id },
				data: {
					...fields,
					...(stageChanged ? { stageChangedAt: new Date() } : {}),
				},
			});
			await this.dealChanges.recordDiffs({
				dealId: existing.id,
				before: existing,
				after: {
					stage: mapped.stage,
					probability: mapped.probability,
					amount: mapped.amount,
					expectedCloseDate: mapped.expectedCloseDate,
					ownerId,
					priority: existing.priority,
					sageStage: mapped.sageStage,
				},
				source: "sage",
			});
			return existing.id;
		}

		const created = await this.db.deal.create({
			data: {
				...fields,
				sageCrmOpportunityId: mapped.sageCrmOpportunityId,
				stageChangedAt: mapped.openedAt ?? new Date(),
			},
			select: { id: true },
		});
		return created.id;
	}

	private async linkPrimaryDealContact(
		dealId: string,
		sageCrmContactId: string,
	): Promise<boolean> {
		const contact = await this.db.contact.findUnique({
			where: { sageCrmContactId },
			select: { id: true },
		});
		if (!contact) return false;

		await this.db.dealContact.createMany({
			data: [{ dealId, contactId: contact.id, role: "primary" }],
			skipDuplicates: true,
		});
		return true;
	}

	private async resolveOwnerId(
		sageUserId: string | null,
	): Promise<string | null> {
		const email = emailForSageUser(sageUserId);
		if (!email) return null;
		const user = await this.db.user.findFirst({
			where: { email },
			select: { id: true },
		});
		return user?.id ?? null;
	}

	/**
	 * Never leave `ownerId` null. Prefer Ken; else earliest User by createdAt.
	 */
	private async resolveFallbackOwnerId(): Promise<string | null> {
		const ken = await this.db.user.findFirst({
			where: { email: FALLBACK_OWNER_EMAIL },
			select: { id: true },
		});
		if (ken) return ken.id;

		const earliest = await this.db.user.findFirst({
			orderBy: { createdAt: "asc" },
			select: { id: true },
		});
		return earliest?.id ?? null;
	}

	// --- full pull (backfill) -------------------------------------------------

	/**
	 * Full pull of every non-deleted company (+ nested people) then every
	 * non-deleted opportunity (plan §6). One global Sage session, throttled,
	 * snapshot-first. Idempotent, so a fresh re-run after a crash is always safe.
	 *
	 * The company walk uses Sage's own `query` -> `next` pagination, which walks
	 * the COMPLETE matching set regardless of row order — the correctness this
	 * relies on. `backfillId` (max id seen) is recorded for progress only; a true
	 * id-paged resume is deferred until we confirm Sage orders by id (a re-run is
	 * cheap because every write keys off `sageCrm*Id`).
	 */
	async runBackfill(
		options: SageBackfillOptions = {},
	): Promise<SageBackfillSummary> {
		const dryRun = options.dryRun ?? false;
		if (!this.soap.isConfigured()) {
			return emptyBackfill(
				"not-configured",
				dryRun,
				"Sage SOAP is not configured.",
			);
		}

		const ran = await withSageSession(this.db, this.soap, () =>
			this.runBackfillLocked(dryRun, options.maxCompanies),
		);
		if (ran.outcome === "busy") {
			return emptyBackfill(
				"busy",
				dryRun,
				"A Sage sync is already running.",
			);
		}
		return ran.value;
	}

	private async runBackfillLocked(
		dryRun: boolean,
		maxCompanies?: number,
	): Promise<SageBackfillSummary> {
		const summary: SageBackfillSummary = {
			outcome: "ok",
			dryRun,
			pages: 0,
			companiesFetched: 0,
			companiesUpserted: 0,
			contactsUpserted: 0,
			dealsFetched: 0,
			dealsUpserted: 0,
			dealContactsLinked: 0,
			snapshotsWritten: 0,
			skipped: 0,
		};

		try {
			if (!dryRun) {
				const users = await ensureSageUsers(this.db);
				this.logger.log({ message: "Sage users ensured", ...users });
			}

			const companies = await this.backfillCompanies(
				summary,
				dryRun,
				maxCompanies,
			);
			if (companies.outcome !== "ok") {
				summary.outcome = companies.outcome;
				summary.reason = companies.reason;
				return summary;
			}

			const opps = await this.backfillOpportunities(summary, dryRun);
			if (opps.outcome !== "ok") {
				summary.outcome = opps.outcome;
				summary.reason = opps.reason;
				return summary;
			}

			// Only a COMPLETE full walk flips the phase to incremental. A capped
			// (`--max`) or ceiling-truncated run is a partial backfill.
			if (!dryRun && companies.completed) await this.markBackfillComplete();

			this.logger.log({ message: "Sage backfill finished", ...summary });
			return summary;
		} catch (error) {
			const reason =
				error instanceof Error ? error.message : String(error);
			this.logger.error(
				{ message: "Sage backfill failed", reason },
				error instanceof Error ? error.stack : String(error),
			);
			summary.outcome = "failed";
			summary.reason = reason;
			return summary;
		}
	}

	/** Walk every non-deleted company page, snapshot-first, throttled. */
	private async backfillCompanies(
		summary: SageBackfillSummary,
		dryRun: boolean,
		maxCompanies?: number,
	): Promise<{ outcome: SageOutcome; reason?: string; completed: boolean }> {
		const takenDomains = await this.loadTakenDomains();
		const ownerByEmail = await this.loadOwnerCache();

		let more = true;
		let firstPage = true;
		let maxId: string | null = null;
		let truncated = false;

		while (more) {
			if (summary.pages >= SAGE_MAX_BACKFILL_PAGES) {
				this.logger.warn({
					message: "Sage backfill hit the page ceiling",
					pages: summary.pages,
				});
				truncated = true;
				break;
			}

			const page = firstPage
				? await this.soap.queryCompanies("comp_deleted IS NULL")
				: await this.soap.nextCompanies();
			firstPage = false;

			if (page.outcome !== "ok") {
				return {
					outcome: page.outcome,
					reason: page.reason,
					completed: false,
				};
			}
			summary.pages += 1;

			for (const tree of page.data.companies) {
				summary.companiesFetched += 1;
				maxId = maxNumericId(maxId, tree.company.companyid);

				if (dryRun) {
					const mapped = mapCompanyTree(tree);
					if (mapped) {
						summary.companiesUpserted += 1;
						summary.contactsUpserted += countMappableContacts(tree);
					} else {
						summary.skipped += 1;
					}
				} else {
					const result = await this.upsertCompanyTree(
						tree,
						takenDomains,
						ownerByEmail,
					);
					summary.companiesUpserted += result.company ? 1 : 0;
					summary.contactsUpserted += result.contacts;
					summary.snapshotsWritten += result.snapshots;
					summary.skipped += result.skipped;
				}

				if (maxCompanies && summary.companiesFetched >= maxCompanies) {
					more = false;
					truncated = true;
					break;
				}
			}

			if (!dryRun) {
				await this.checkpointCompanyBackfill(maxId, summary.companiesFetched);
			}

			this.logger.log({
				message: "Sage backfill progress",
				dryRun,
				pages: summary.pages,
				companiesFetched: summary.companiesFetched,
				contactsUpserted: summary.contactsUpserted,
				lastCompanyId: maxId,
			});

			if (more) more = page.data.more;
			if (more) await delay(SAGE_PAGE_DELAY_MS);
		}

		return { outcome: "ok", completed: !truncated };
	}

	/** Pull every non-deleted opportunity and map onto deals. */
	private async backfillOpportunities(
		summary: SageBackfillSummary,
		dryRun: boolean,
	): Promise<{ outcome: SageOutcome; reason?: string }> {
		const fetched = await this.soap.queryAllRecords(
			"opportunity",
			"oppo_deleted IS NULL",
		);
		if (fetched.outcome !== "ok") {
			return { outcome: fetched.outcome, reason: fetched.reason };
		}
		summary.dealsFetched = fetched.data.length;

		if (dryRun) {
			for (const record of fetched.data) {
				if (mapOpportunity(record)) summary.dealsUpserted += 1;
				else summary.skipped += 1;
			}
			return { outcome: "ok" };
		}

		const companyBySageId = await this.loadCompanyBySageId();
		const ownerCache = await this.loadOwnerCache();
		const fallbackOwnerId = await this.resolveFallbackOwnerId();
		if (!fallbackOwnerId) {
			this.logger.warn({
				message:
					"No local User for deal owner fallback — skipping opportunities",
			});
			summary.skipped += fetched.data.length;
			return { outcome: "ok" };
		}

		for (const record of fetched.data) {
			const mapped = mapOpportunity(record);
			if (!mapped) {
				summary.skipped += 1;
				continue;
			}

			summary.snapshotsWritten += await this.writeSnapshot(
				"opportunity",
				mapped.sageCrmOpportunityId,
				record,
			);

			const companyId = companyBySageId.get(mapped.sageCrmCompanyId);
			if (!companyId) {
				summary.skipped += 1;
				continue;
			}

			const ownerId =
				ownerCache.get(emailForSageUser(mapped.sageAssignedUserId) ?? "") ??
				fallbackOwnerId;

			const dealId = await this.upsertDeal(mapped, companyId, ownerId);
			if (!dealId) {
				summary.skipped += 1;
				continue;
			}
			summary.dealsUpserted += 1;

			if (mapped.sageCrmPrimaryPersonId) {
				const linked = await this.linkPrimaryDealContact(
					dealId,
					mapped.sageCrmPrimaryPersonId,
				);
				if (linked) summary.dealContactsLinked += 1;
			}
		}

		return { outcome: "ok" };
	}

	// --- scheduled entrypoint -------------------------------------------------

	/**
	 * What `GET /internal/sync/sage` (the cron) runs.
	 *
	 * While the company entity is still in `backfill` phase — i.e. the one-shot
	 * full pull has NOT completed yet — this stays the safe bounded test slice.
	 * Once the backfill flips the phase to `incremental`, the same route becomes
	 * the nightly incremental pull. The full backfill itself never runs through
	 * this web route (it is the `sage-backfill.ts` script).
	 */
	async runScheduled(): Promise<SageTestSliceSummary | SageBackfillSummary> {
		const state = await this.db.sageSyncState.findUnique({
			where: { entity: "company" },
			select: { phase: true },
		});
		if (state?.phase === "incremental") {
			return this.runIncremental();
		}
		return this.importTestSlice();
	}

	// --- incremental (nightly) ------------------------------------------------

	/**
	 * Nightly incremental pull: only companies/opportunities changed since the
	 * high-water, with an overlap. Idempotent upserts absorb the overlap. Runs
	 * inside the one global Sage session.
	 */
	async runIncremental(
		options: { dryRun?: boolean } = {},
	): Promise<SageBackfillSummary> {
		const dryRun = options.dryRun ?? false;
		if (!this.soap.isConfigured()) {
			return emptyBackfill(
				"not-configured",
				dryRun,
				"Sage SOAP is not configured.",
			);
		}

		const ran = await withSageSession(this.db, this.soap, () =>
			this.runIncrementalLocked(dryRun),
		);
		if (ran.outcome === "busy") {
			return emptyBackfill("busy", dryRun, "A Sage sync is already running.");
		}
		return ran.value;
	}

	private async runIncrementalLocked(
		dryRun: boolean,
	): Promise<SageBackfillSummary> {
		const summary: SageBackfillSummary = {
			outcome: "ok",
			dryRun,
			pages: 0,
			companiesFetched: 0,
			companiesUpserted: 0,
			contactsUpserted: 0,
			dealsFetched: 0,
			dealsUpserted: 0,
			dealContactsLinked: 0,
			snapshotsWritten: 0,
			skipped: 0,
		};

		try {
			const since = await this.incrementalSince();
			const startedAt = new Date();
			const takenDomains = await this.loadTakenDomains();
			const ownerByEmail = await this.loadOwnerCache();

			const changedPredicate = since
				? `${SAGE_UPDATED_COLUMN.company} > '${sageDate(since)}' AND comp_deleted IS NULL`
				: "comp_deleted IS NULL";

			let more = true;
			let firstPage = true;
			while (more) {
				if (summary.pages >= SAGE_MAX_BACKFILL_PAGES) break;
				const page = firstPage
					? await this.soap.queryCompanies(changedPredicate)
					: await this.soap.nextCompanies();
				firstPage = false;
				if (page.outcome !== "ok") {
					summary.outcome = page.outcome;
					summary.reason = page.reason;
					return summary;
				}
				summary.pages += 1;
				for (const tree of page.data.companies) {
					summary.companiesFetched += 1;
					if (dryRun) {
						const mapped = mapCompanyTree(tree);
						if (mapped) {
							summary.companiesUpserted += 1;
							summary.contactsUpserted += countMappableContacts(tree);
						} else {
							summary.skipped += 1;
						}
					} else {
						const result = await this.upsertCompanyTree(
							tree,
							takenDomains,
							ownerByEmail,
						);
						summary.companiesUpserted += result.company ? 1 : 0;
						summary.contactsUpserted += result.contacts;
						summary.snapshotsWritten += result.snapshots;
						summary.skipped += result.skipped;
					}
				}
				if (more) more = page.data.more;
				if (more) await delay(SAGE_PAGE_DELAY_MS);
			}

			const oppPredicate = since
				? `${SAGE_UPDATED_COLUMN.opportunity} > '${sageDate(since)}' AND oppo_deleted IS NULL`
				: "oppo_deleted IS NULL";
			const opps = await this.backfillOpportunitiesPredicate(
				summary,
				oppPredicate,
				dryRun,
			);
			if (opps.outcome !== "ok") {
				summary.outcome = opps.outcome;
				summary.reason = opps.reason;
				return summary;
			}

			// A dry run reports what would change but never advances the cursor.
			if (!dryRun) await this.advanceHighWater(startedAt);
			this.logger.log({
				message: dryRun
					? "Sage incremental dry-run finished"
					: "Sage incremental finished",
				...summary,
			});
			return summary;
		} catch (error) {
			const reason =
				error instanceof Error ? error.message : String(error);
			this.logger.error(
				{ message: "Sage incremental failed", reason },
				error instanceof Error ? error.stack : String(error),
			);
			summary.outcome = "failed";
			summary.reason = reason;
			return summary;
		}
	}

	/** Opportunity walk against an arbitrary predicate (shared by incremental). */
	private async backfillOpportunitiesPredicate(
		summary: SageBackfillSummary,
		predicate: string,
		dryRun = false,
	): Promise<{ outcome: SageOutcome; reason?: string }> {
		const fetched = await this.soap.queryAllRecords("opportunity", predicate);
		if (fetched.outcome !== "ok") {
			return { outcome: fetched.outcome, reason: fetched.reason };
		}
		summary.dealsFetched += fetched.data.length;

		if (dryRun) {
			for (const record of fetched.data) {
				if (mapOpportunity(record)) summary.dealsUpserted += 1;
				else summary.skipped += 1;
			}
			return { outcome: "ok" };
		}

		const companyBySageId = await this.loadCompanyBySageId();
		const ownerCache = await this.loadOwnerCache();
		const fallbackOwnerId = await this.resolveFallbackOwnerId();
		if (!fallbackOwnerId) {
			summary.skipped += fetched.data.length;
			return { outcome: "ok" };
		}

		for (const record of fetched.data) {
			const mapped = mapOpportunity(record);
			if (!mapped) {
				summary.skipped += 1;
				continue;
			}
			summary.snapshotsWritten += await this.writeSnapshot(
				"opportunity",
				mapped.sageCrmOpportunityId,
				record,
			);
			const companyId = companyBySageId.get(mapped.sageCrmCompanyId);
			if (!companyId) {
				summary.skipped += 1;
				continue;
			}
			const ownerId =
				ownerCache.get(emailForSageUser(mapped.sageAssignedUserId) ?? "") ??
				fallbackOwnerId;
			const dealId = await this.upsertDeal(mapped, companyId, ownerId);
			if (!dealId) {
				summary.skipped += 1;
				continue;
			}
			summary.dealsUpserted += 1;
			if (mapped.sageCrmPrimaryPersonId) {
				const linked = await this.linkPrimaryDealContact(
					dealId,
					mapped.sageCrmPrimaryPersonId,
				);
				if (linked) summary.dealContactsLinked += 1;
			}
		}
		return { outcome: "ok" };
	}

	// --- state + caches -------------------------------------------------------

	private async checkpointCompanyBackfill(
		backfillId: string | null,
		processed: number,
	): Promise<void> {
		await this.db.sageSyncState.upsert({
			where: { entity: "company" },
			create: {
				entity: "company",
				status: "RUNNING",
				phase: "backfill",
				backfillId,
				processed,
			},
			update: {
				status: "RUNNING",
				phase: "backfill",
				backfillId,
				processed,
				lastSyncedAt: new Date(),
			},
		});
	}

	private async markBackfillComplete(): Promise<void> {
		const now = new Date();
		for (const entity of ["company", "opportunity"]) {
			await this.db.sageSyncState.upsert({
				where: { entity },
				create: {
					entity,
					status: "IDLE",
					phase: "incremental",
					highWaterUpdatedAt: now,
					backfillDoneAt: now,
				},
				update: {
					status: "IDLE",
					phase: "incremental",
					highWaterUpdatedAt: now,
					backfillDoneAt: now,
					lastSyncedAt: now,
				},
			});
		}
	}

	/** The oldest high-water across company/opportunity, minus the overlap. */
	private async incrementalSince(): Promise<Date | null> {
		const states = await this.db.sageSyncState.findMany({
			where: { entity: { in: ["company", "opportunity"] } },
			select: { highWaterUpdatedAt: true },
		});
		const waters = states
			.map((s) => s.highWaterUpdatedAt)
			.filter((d): d is Date => d !== null);
		if (waters.length === 0) return null;
		const oldest = waters.reduce((a, b) => (a < b ? a : b));
		return new Date(oldest.getTime() - SAGE_INCREMENTAL_OVERLAP_MS);
	}

	private async advanceHighWater(to: Date): Promise<void> {
		for (const entity of ["company", "opportunity"]) {
			await this.db.sageSyncState.upsert({
				where: { entity },
				create: {
					entity,
					status: "IDLE",
					phase: "incremental",
					highWaterUpdatedAt: to,
				},
				update: {
					status: "IDLE",
					phase: "incremental",
					highWaterUpdatedAt: to,
					lastSyncedAt: to,
				},
			});
		}
	}

	private async loadCompanyBySageId(): Promise<Map<string, string>> {
		const rows = await this.db.company.findMany({
			where: { sageCrmCompanyId: { not: null } },
			select: { id: true, sageCrmCompanyId: true },
		});
		const map = new Map<string, string>();
		for (const row of rows) {
			if (row.sageCrmCompanyId) map.set(row.sageCrmCompanyId, row.id);
		}
		return map;
	}

	/** email -> local User id, for every known Sage owner email (one query). */
	private async loadOwnerCache(): Promise<Map<string, string>> {
		const emails = [...new Set(Object.values(SAGE_USER_EMAILS))];
		const users = await this.db.user.findMany({
			where: { email: { in: emails } },
			select: { id: true, email: true },
		});
		const map = new Map<string, string>();
		for (const user of users) map.set(user.email, user.id);
		return map;
	}

	private async loadTakenDomains(): Promise<Set<string>> {
		const rows = await this.db.company.findMany({
			where: { domain: { not: null } },
			select: { domain: true },
		});
		const set = new Set<string>();
		for (const row of rows) {
			if (row.domain) set.add(row.domain);
		}
		return set;
	}

	private async upsertCompanyTree(
		tree: SageCompanyTree,
		takenDomains: Set<string>,
		ownerByEmail: Map<string, string>,
	): Promise<{
		company: boolean;
		contacts: number;
		snapshots: number;
		skipped: number;
		localCompanyId: string | null;
		sageCrmCompanyId: string | null;
	}> {
		const mapped = mapCompanyTree(tree);
		if (!mapped) {
			return {
				company: false,
				contacts: 0,
				snapshots: 0,
				skipped: 1,
				localCompanyId: null,
				sageCrmCompanyId: null,
			};
		}

		let snapshots = 0;
		snapshots += await this.writeSnapshot("company", mapped.sageCrmCompanyId, {
			company: tree.company,
			address: tree.address,
			email: tree.email,
			phone: tree.phone,
			people: tree.people,
		});

		// Company owner from Sage `acctmgr` (a name). Unmatched names / blanks
		// resolve to null — those companies stay owner-less by design.
		const ownerId =
			ownerByEmail.get(emailForAcctMgr(mapped.accountManagerName) ?? "") ??
			null;

		const companyId = await this.upsertCompany(mapped, takenDomains, ownerId);
		if (!companyId) {
			return {
				company: false,
				contacts: 0,
				snapshots,
				skipped: 1,
				localCompanyId: null,
				sageCrmCompanyId: mapped.sageCrmCompanyId,
			};
		}

		let contacts = 0;
		let skipped = 0;
		const contactBySageId = new Map<string, string>();

		for (const person of tree.people) {
			const contact = mapContact(person, mapped.sageCrmCompanyId);
			if (!contact) {
				skipped += 1;
				continue;
			}

			snapshots += await this.writeSnapshot(
				"person",
				contact.sageCrmContactId,
				person,
			);

			// Contacts inherit their company's owner (plan decision).
			const contactId = await this.upsertContact(contact, companyId, ownerId);
			if (!contactId) {
				skipped += 1;
				continue;
			}
			contacts += 1;
			contactBySageId.set(contact.sageCrmContactId, contactId);
		}

		if (mapped.primaryPersonId) {
			const primaryId = contactBySageId.get(mapped.primaryPersonId);
			if (primaryId) {
				await this.db.company.update({
					where: { id: companyId },
					data: { primaryContactId: primaryId },
				});
			}
		}

		return {
			company: true,
			contacts,
			snapshots,
			skipped,
			localCompanyId: companyId,
			sageCrmCompanyId: mapped.sageCrmCompanyId,
		};
	}

	private async upsertCompany(
		mapped: MappedCompany,
		takenDomains: Set<string>,
		ownerId: string | null,
	): Promise<string | null> {
		// Only ever SET an owner from Sage, never clear one — so a blank/unmatched
		// acctmgr on a later pull cannot wipe an owner a human assigned.
		const ownerData = ownerId ? { ownerId } : {};

		const existing = await this.db.company.findUnique({
			where: { sageCrmCompanyId: mapped.sageCrmCompanyId },
			select: {
				id: true,
				domain: true,
				sagePushedAt: true,
				city: true,
				stateCode: true,
				country: true,
				countryCode: true,
			},
		});

		if (existing) {
			if (isPushEcho(mapped.sageUpdatedAt, existing.sagePushedAt)) {
				await this.db.company.update({
					where: { id: existing.id },
					data: { sageUpdatedAt: mapped.sageUpdatedAt },
				});
				return existing.id;
			}
			const domain = resolveDomain(
				mapped.domain,
				existing.domain,
				takenDomains,
			);
			const locationChanged =
				existing.city !== mapped.city ||
				existing.stateCode !== mapped.stateCode ||
				existing.country !== mapped.country ||
				existing.countryCode !== mapped.countryCode;
			await this.db.company.update({
				where: { id: existing.id },
				data: {
					name: mapped.name,
					website: mapped.website,
					email: mapped.email,
					phone: mapped.phone,
					city: mapped.city,
					stateCode: mapped.stateCode,
					country: mapped.country,
					countryCode: mapped.countryCode,
					sage100CustomerNo: mapped.sage100CustomerNo,
					sage100ArDivisionNo: mapped.sage100ArDivisionNo,
					sageUpdatedAt: mapped.sageUpdatedAt,
					...(locationChanged
						? {
								latitude: null,
								longitude: null,
								geocodePlaceKey: null,
								geocodedAt: null,
							}
						: {}),
					...ownerData,
					...(domain && !existing.domain ? { domain } : {}),
				},
			});
			if (domain) takenDomains.add(domain);
			return existing.id;
		}

		// Natural-key fallback: an existing company with this domain and NO Sage
		// id gets the Sage link. Look up by the mapped domain even when it is
		// already "taken" in the set (that row is the one we want to attach to).
		if (mapped.domain) {
			const byDomain = await this.db.company.findUnique({
				where: { domain: mapped.domain },
				select: { id: true, sageCrmCompanyId: true },
			});
			if (byDomain && !byDomain.sageCrmCompanyId) {
				await this.db.company.update({
					where: { id: byDomain.id },
					data: {
						sageCrmCompanyId: mapped.sageCrmCompanyId,
						name: mapped.name,
						website: mapped.website,
						email: mapped.email,
						phone: mapped.phone,
						city: mapped.city,
						stateCode: mapped.stateCode,
						country: mapped.country,
						countryCode: mapped.countryCode,
						sage100CustomerNo: mapped.sage100CustomerNo,
						sage100ArDivisionNo: mapped.sage100ArDivisionNo,
						sageUpdatedAt: mapped.sageUpdatedAt,
						latitude: null,
						longitude: null,
						geocodePlaceKey: null,
						geocodedAt: null,
						source: RecordSource.SAGE,
						...ownerData,
					},
				});
				takenDomains.add(mapped.domain);
				return byDomain.id;
			}
		}

		// Near-duplicate names that share a web domain: leave domain null rather
		// than collide with an existing Sage-linked row on the unique index.
		const createDomain =
			mapped.domain && !takenDomains.has(mapped.domain)
				? mapped.domain
				: null;

		const created = await this.db.company.create({
			data: {
				name: mapped.name,
				domain: createDomain,
				website: mapped.website,
				email: mapped.email,
				phone: mapped.phone,
				city: mapped.city,
				stateCode: mapped.stateCode,
				country: mapped.country,
				countryCode: mapped.countryCode,
				sageCrmCompanyId: mapped.sageCrmCompanyId,
				sage100CustomerNo: mapped.sage100CustomerNo,
				sage100ArDivisionNo: mapped.sage100ArDivisionNo,
				sageUpdatedAt: mapped.sageUpdatedAt,
				source: RecordSource.SAGE,
				...ownerData,
			},
			select: { id: true },
		});

		if (createDomain) takenDomains.add(createDomain);
		return created.id;
	}

	private async upsertContact(
		mapped: MappedContact,
		companyId: string,
		ownerId: string | null = null,
	): Promise<string | null> {
		// Inherit the company owner; only ever SET, never clear a human's choice.
		const ownerData = ownerId ? { ownerId } : {};

		const existing = await this.db.contact.findUnique({
			where: { sageCrmContactId: mapped.sageCrmContactId },
			select: { id: true, sagePushedAt: true },
		});

		if (existing) {
			if (isPushEcho(mapped.sageUpdatedAt, existing.sagePushedAt)) {
				await this.db.contact.update({
					where: { id: existing.id },
					data: { sageUpdatedAt: mapped.sageUpdatedAt },
				});
				return existing.id;
			}
			await this.db.contact.update({
				where: { id: existing.id },
				data: {
					firstName: mapped.firstName,
					lastName: mapped.lastName,
					phone: mapped.phone,
					title: mapped.title,
					companyId,
					sageUpdatedAt: mapped.sageUpdatedAt,
					...ownerData,
					// Email is @unique — only set when blank or already ours.
					...(mapped.email
						? await this.emailUpdateIfFree(mapped.email, existing.id)
						: {}),
				},
			});
			return existing.id;
		}

		// Email-link: local contact with same email, no Sage id yet.
		if (mapped.email) {
			const byEmail = await this.db.contact.findUnique({
				where: { email: mapped.email },
				select: { id: true, sageCrmContactId: true, companyId: true },
			});
			if (byEmail && !byEmail.sageCrmContactId) {
				await this.db.contact.update({
					where: { id: byEmail.id },
					data: {
						sageCrmContactId: mapped.sageCrmContactId,
						firstName: mapped.firstName,
						lastName: mapped.lastName,
						phone: mapped.phone,
						title: mapped.title,
						companyId: byEmail.companyId ?? companyId,
						sageUpdatedAt: mapped.sageUpdatedAt,
						source: RecordSource.SAGE,
						...ownerData,
					},
				});
				return byEmail.id;
			}
			if (byEmail?.sageCrmContactId) {
				// Email belongs to a different Sage person — create without email.
				const created = await this.db.contact.create({
					data: {
						firstName: mapped.firstName,
						lastName: mapped.lastName,
						phone: mapped.phone,
						title: mapped.title,
						companyId,
						sageCrmContactId: mapped.sageCrmContactId,
						sageUpdatedAt: mapped.sageUpdatedAt,
						source: RecordSource.SAGE,
						...ownerData,
					},
					select: { id: true },
				});
				return created.id;
			}
		}

		const created = await this.db.contact.create({
			data: {
				firstName: mapped.firstName,
				lastName: mapped.lastName,
				email: mapped.email,
				phone: mapped.phone,
				title: mapped.title,
				companyId,
				sageCrmContactId: mapped.sageCrmContactId,
				sageUpdatedAt: mapped.sageUpdatedAt,
				source: RecordSource.SAGE,
				...ownerData,
			},
			select: { id: true },
		});
		return created.id;
	}

	/** Only write email when free or already owned by this contact. */
	private async emailUpdateIfFree(
		email: string,
		contactId: string,
	): Promise<{ email: string } | Record<string, never>> {
		const holder = await this.db.contact.findUnique({
			where: { email },
			select: { id: true },
		});
		if (!holder || holder.id === contactId) return { email };
		return {};
	}

	private async writeSnapshot(
		entity: "company" | "person" | "opportunity",
		sageId: string,
		payload: unknown,
	): Promise<number> {
		await this.db.sageRecordSnapshot.upsert({
			where: { entity_sageId: { entity, sageId } },
			create: { entity, sageId, payload: payload as object },
			update: { payload: payload as object },
		});
		return 1;
	}
}

function emptySummary(
	outcome: SageTestSliceSummary["outcome"],
	reason: string,
): SageTestSliceSummary {
	return {
		outcome,
		reason,
		companiesFetched: 0,
		companiesUpserted: 0,
		contactsUpserted: 0,
		dealsUpserted: 0,
		dealContactsLinked: 0,
		snapshotsWritten: 0,
		skipped: 0,
	};
}

function emptyBackfill(
	outcome: SageOutcome,
	dryRun: boolean,
	reason: string,
): SageBackfillSummary {
	return {
		outcome,
		reason,
		dryRun,
		pages: 0,
		companiesFetched: 0,
		companiesUpserted: 0,
		contactsUpserted: 0,
		dealsFetched: 0,
		dealsUpserted: 0,
		dealContactsLinked: 0,
		snapshotsWritten: 0,
		skipped: 0,
	};
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isClosedStage(stage: DealStage): boolean {
	return (
		stage === DealStage.CLOSED_WON || stage === DealStage.CLOSED_LOST
	);
}

/**
 * The date a deal closed: the real Sage `closed` date, else (for a closed-stage
 * deal with no close date) the forecast close, else the open date. Open deals
 * are null. Never "now" — that would bunch dateless deals into the import month.
 */
function resolvedClosedAt(mapped: MappedOpportunity): Date | null {
	if (mapped.closedAt) return mapped.closedAt;
	if (!isClosedStage(mapped.stage)) return null;
	return mapped.expectedCloseDate ?? mapped.openedAt ?? null;
}

/**
 * Pick a domain that will not violate `Company.domain` uniqueness.
 *
 * Prefer keeping an existing domain on update; on create, only claim a domain
 * that is still free. Near-duplicate Mobile Mark rows share a web domain — those
 * land with `domain: null` rather than collapsing into one company.
 */
function resolveDomain(
	candidate: string | null,
	existing: string | null | undefined,
	taken: Set<string>,
): string | null {
	if (existing) return existing;
	if (!candidate) return null;
	if (taken.has(candidate)) return null;
	return candidate;
}
