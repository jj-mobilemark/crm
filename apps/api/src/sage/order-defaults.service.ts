import {
	assignRep,
	type Db,
	isDistributor,
	loadSalesTerritory,
	Prisma,
} from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

const COMPANY_SELECT = {
	id: true,
	name: true,
	sageCrmCompanyId: true,
	sage100CustomerNo: true,
	sage100ArDivisionNo: true,
	stateCode: true,
	countryCode: true,
	owner: { select: { name: true, email: true } },
	primaryContact: {
		select: { firstName: true, lastName: true, email: true, phone: true },
	},
	// Fallback when Sage has no primary contact set — same rule the company
	// list/sheet already use (`CompaniesService`): most recently created.
	contacts: {
		take: 1,
		orderBy: { createdAt: "desc" },
		select: { firstName: true, lastName: true, email: true, phone: true },
	},
} satisfies Prisma.CompanyFindFirstArgs["select"];

type CompanyRow = Prisma.CompanyGetPayload<{ select: typeof COMPANY_SELECT }>;

export type OrderDefaults = {
	matched_by: "mas_customer_no" | "name_zip";
	company_id: string;
	company_name: string;
	mas_customer_no: string | null;
	mas_ar_division_no: string | null;
	attention: string | null;
	phone: string | null;
	email: string | null;
	/** Sage 100 terms code from the company SOAP snapshot (`mas_termscode`). */
	terms_code: string | null;
	rep_owner: { name: string | null; email: string | null } | null;
	rep_territory: {
		rep_code: string;
		email: string;
		reason: "exception" | "geo" | "international";
	} | null;
	is_distributor: boolean;
	/** Which of the fields above came back non-null — partial is expected. */
	fields_returned: string[];
};

/**
 * Order-defaults lookup for external callers (the doc-scanner / PO-processing
 * sister app). Read-only, mechanical: it returns exactly what this CRM's Sage
 * pull already has, never a guess. See `docs/plans/sage-crm-sync.md` §7 for
 * what is and is not sourced yet (tracking/AP email, ship_via, freight are
 * still out of scope — no columns / no snapshot field for them yet).
 */
@Injectable()
export class OrderDefaultsService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async byMasCustomerNo(masCustomerNo: string): Promise<OrderDefaults | null> {
		const company = await this.db.company.findFirst({
			where: { sage100CustomerNo: masCustomerNo },
			select: COMPANY_SELECT,
		});
		if (!company) return null;
		return this.toOrderDefaults(company, "mas_customer_no");
	}

	async byNameAndZip(name: string, zip: string): Promise<OrderDefaults | null> {
		const company = await this.db.company.findFirst({
			where: {
				postalCode: zip.trim(),
				name: { equals: name.trim(), mode: "insensitive" },
			},
			select: COMPANY_SELECT,
		});
		if (!company) return null;
		return this.toOrderDefaults(company, "name_zip");
	}

	private async toOrderDefaults(
		company: CompanyRow,
		matchedBy: OrderDefaults["matched_by"],
	): Promise<OrderDefaults> {
		const contact = company.primaryContact ?? company.contacts[0] ?? null;
		const attention = contact
			? [contact.firstName, contact.lastName].filter(Boolean).join(" ")
			: "";

		const territory = loadSalesTerritory();
		const repTerritory = assignRep(territory, {
			companyName: company.name,
			stateCode: company.stateCode,
			countryCode: company.countryCode,
		});

		const termsCode = await this.termsCodeFromSnapshot(
			company.sageCrmCompanyId,
		);

		const result: OrderDefaults = {
			matched_by: matchedBy,
			company_id: company.id,
			company_name: company.name,
			mas_customer_no: company.sage100CustomerNo,
			mas_ar_division_no: company.sage100ArDivisionNo,
			attention: attention || null,
			phone: contact?.phone ?? null,
			email: contact?.email ?? null,
			terms_code: termsCode,
			rep_owner: company.owner
				? { name: company.owner.name, email: company.owner.email }
				: null,
			rep_territory: repTerritory
				? {
						rep_code: repTerritory.repCode,
						email: repTerritory.email,
						reason: repTerritory.reason,
					}
				: null,
			is_distributor: isDistributor(territory, company.name),
			fields_returned: [],
		};

		const fieldsReturned: string[] = (
			[
				["mas_customer_no", result.mas_customer_no],
				["attention", result.attention],
				["phone", result.phone],
				["email", result.email],
				["terms_code", result.terms_code],
				["rep_owner", result.rep_owner],
				["rep_territory", result.rep_territory],
			] as const
		)
			.filter(([, value]) => value !== null)
			.map(([key]) => key);
		// is_distributor is a verdict (true/false), always answerable.
		fieldsReturned.push("is_distributor");
		result.fields_returned = fieldsReturned;

		return result;
	}

	/**
	 * Sage stores the AR terms code on the company SOAP record as
	 * `mas_termscode` (e.g. "03"). We never promoted it to a Company column,
	 * but the nightly pull keeps it in `SageRecordSnapshot` — read it from
	 * there. Null when there is no Sage id, no snapshot, or an empty code.
	 */
	private async termsCodeFromSnapshot(
		sageCrmCompanyId: string | null,
	): Promise<string | null> {
		if (!sageCrmCompanyId) return null;

		const snapshot = await this.db.sageRecordSnapshot.findUnique({
			where: {
				entity_sageId: { entity: "company", sageId: sageCrmCompanyId },
			},
			select: { payload: true },
		});
		if (!snapshot) return null;

		const payload = snapshot.payload as {
			company?: { mas_termscode?: unknown };
		};
		const raw = payload.company?.mas_termscode;
		if (typeof raw !== "string") return null;
		const trimmed = raw.trim();
		return trimmed.length > 0 ? trimmed : null;
	}
}
