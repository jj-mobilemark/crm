import { type Db, DealStage, RecordSource } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { SageSoapClient } from "./sage-soap.client";
import {
	SAGE_TEST_NAME_PREDICATE,
	SAGE_TEST_OPPORTUNITY_COMPANY_ID,
} from "./sage.constants";
import {
	emailForSageUser,
	mapCompanyTree,
	mapContact,
	mapOpportunity,
	type MappedCompany,
	type MappedContact,
	type MappedOpportunity,
} from "./sage.mappings";
import type { SageCompanyTree } from "./sage-xml";

/** Fallback owner when Sage assigneduserid is unmapped (Ken — Sage id 27). */
const FALLBACK_OWNER_EMAIL = "ken@mobilemark.com";

export type SageTestSliceSummary = {
	outcome: "ok" | "not-configured" | "auth-failed" | "failed" | "busy";
	reason?: string;
	companiesFetched: number;
	companiesUpserted: number;
	contactsUpserted: number;
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
	private running = false;

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly soap: SageSoapClient,
	) {}

	/**
	 * Import the Mobile Mark test companies, nested people, and opportunities.
	 *
	 * Bounded predicate — ~8 companies / ~4 deals on company 24, one session,
	 * always logoff.
	 */
	async importTestSlice(): Promise<SageTestSliceSummary> {
		if (this.running) {
			return emptySummary("busy", "A Sage sync is already running.");
		}
		if (!this.soap.isConfigured()) {
			return emptySummary(
				"not-configured",
				"Sage SOAP is not configured.",
			);
		}

		this.running = true;
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
			const companyBySageId = new Map<string, string>();

			for (const tree of trees) {
				const result = await this.upsertCompanyTree(tree, takenDomains);
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
		} finally {
			await this.soap.logoff();
			this.running = false;
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
			select: { id: true, stage: true },
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
			closedAt: mapped.closedAt,
		};

		if (existing) {
			const stageChanged = existing.stage !== mapped.stage;
			await this.db.deal.update({
				where: { id: existing.id },
				data: {
					...fields,
					...(stageChanged
						? { stageChangedAt: new Date() }
						: {}),
				},
			});
			return existing.id;
		}

		const created = await this.db.deal.create({
			data: {
				...fields,
				sageCrmOpportunityId: mapped.sageCrmOpportunityId,
				stageChangedAt: new Date(),
				closedAt:
					mapped.closedAt ??
					(isClosedStage(mapped.stage) ? new Date() : null),
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

		const companyId = await this.upsertCompany(mapped, takenDomains);
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

			const contactId = await this.upsertContact(contact, companyId);
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
	): Promise<string | null> {
		const existing = await this.db.company.findUnique({
			where: { sageCrmCompanyId: mapped.sageCrmCompanyId },
			select: { id: true, domain: true },
		});

		if (existing) {
			const domain = resolveDomain(
				mapped.domain,
				existing.domain,
				takenDomains,
			);
			await this.db.company.update({
				where: { id: existing.id },
				data: {
					name: mapped.name,
					website: mapped.website,
					email: mapped.email,
					phone: mapped.phone,
					city: mapped.city,
					sage100CustomerNo: mapped.sage100CustomerNo,
					sage100ArDivisionNo: mapped.sage100ArDivisionNo,
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
						sage100CustomerNo: mapped.sage100CustomerNo,
						sage100ArDivisionNo: mapped.sage100ArDivisionNo,
						source: RecordSource.SAGE,
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
				sageCrmCompanyId: mapped.sageCrmCompanyId,
				sage100CustomerNo: mapped.sage100CustomerNo,
				sage100ArDivisionNo: mapped.sage100ArDivisionNo,
				source: RecordSource.SAGE,
			},
			select: { id: true },
		});

		if (createDomain) takenDomains.add(createDomain);
		return created.id;
	}

	private async upsertContact(
		mapped: MappedContact,
		companyId: string,
	): Promise<string | null> {
		const existing = await this.db.contact.findUnique({
			where: { sageCrmContactId: mapped.sageCrmContactId },
			select: { id: true },
		});

		if (existing) {
			await this.db.contact.update({
				where: { id: existing.id },
				data: {
					firstName: mapped.firstName,
					lastName: mapped.lastName,
					phone: mapped.phone,
					title: mapped.title,
					companyId,
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
						source: RecordSource.SAGE,
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
						source: RecordSource.SAGE,
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
				source: RecordSource.SAGE,
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

function isClosedStage(stage: DealStage): boolean {
	return (
		stage === DealStage.CLOSED_WON || stage === DealStage.CLOSED_LOST
	);
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
