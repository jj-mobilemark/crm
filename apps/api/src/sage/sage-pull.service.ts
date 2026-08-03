import { type Db, RecordSource } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { SageSoapClient } from "./sage-soap.client";
import {
	SAGE_TEST_NAME_PREDICATE,
	SAGE_TEST_OPPORTUNITY_COMPANY_ID,
} from "./sage.constants";
import {
	mapCompanyTree,
	mapContact,
	type MappedCompany,
	type MappedContact,
} from "./sage.mappings";
import type { SageCompanyTree } from "./sage-xml";

export type SageTestSliceSummary = {
	outcome: "ok" | "not-configured" | "auth-failed" | "failed" | "busy";
	reason?: string;
	companiesFetched: number;
	companiesUpserted: number;
	contactsUpserted: number;
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
	 * Import the Mobile Mark test companies (and nested people).
	 *
	 * Bounded predicate — ~8 companies, one session, always logoff. Opportunities
	 * wait for the Deal forecasting fields (deferred).
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

			for (const tree of trees) {
				const result = await this.upsertCompanyTree(tree, takenDomains);
				summary.companiesUpserted += result.company ? 1 : 0;
				summary.contactsUpserted += result.contacts;
				summary.snapshotsWritten += result.snapshots;
				summary.skipped += result.skipped;
			}

			this.logger.log({
				message: "Sage test-slice import finished",
				companiesFetched: summary.companiesFetched,
				companiesUpserted: summary.companiesUpserted,
				contactsUpserted: summary.contactsUpserted,
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
	}> {
		const mapped = mapCompanyTree(tree);
		if (!mapped) {
			return { company: false, contacts: 0, snapshots: 0, skipped: 1 };
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
			return { company: false, contacts: 0, snapshots, skipped: 1 };
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

		return { company: true, contacts, snapshots, skipped };
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
		entity: "company" | "person",
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
		snapshotsWritten: 0,
		skipped: 0,
	};
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
