import { DealStage } from "@crm/db";
import type { SageCompanyTree, SageRecord } from "./sage-xml";

/**
 * Sage -> local field mappings. See `docs/plans/sage-crm-sync.md` section 3.
 *
 * Pure functions over a flattened `SageRecord` (see `sage-xml.ts`). Only fields
 * Sage OWNS are mapped; agent-owned enrichment (logo, industry, brief) is never
 * touched by a pull. Everything is normalised to `string | null` so a blank
 * Sage value becomes a real null rather than an empty string.
 */

export type MappedCompany = {
	sageCrmCompanyId: string;
	name: string;
	/** Sage 100 customer number, e.g. "0000777" / "MME". */
	sage100CustomerNo: string | null;
	/** Sage 100 AR division, e.g. "00". */
	sage100ArDivisionNo: string | null;
	website: string | null;
	domain: string | null;
	email: string | null;
	phone: string | null;
	city: string | null;
	/** Sage primary person id, when present — used to set `primaryContactId`. */
	primaryPersonId: string | null;
};

export type MappedContact = {
	sageCrmContactId: string;
	/** The parent company's Sage CRM id, used to link to the local company. */
	sageCrmCompanyId: string | null;
	firstName: string;
	lastName: string | null;
	email: string | null;
	phone: string | null;
	title: string | null;
};

/**
 * Map a hierarchical company tree: company scalars plus first nested
 * address / email / phone (Sage association is by nesting, not FK).
 */
export function mapCompanyTree(tree: SageCompanyTree): MappedCompany | null {
	const merged: SageRecord = { ...tree.company };

	if (tree.address) {
		if (!merged.city && tree.address.city) merged.city = tree.address.city;
		if (!merged.state && tree.address.state) merged.state = tree.address.state;
		if (!merged.country && tree.address.country) {
			merged.country = tree.address.country;
		}
	}
	if (tree.email?.emailaddress && !merged.emailaddress) {
		merged.emailaddress = tree.email.emailaddress;
	}
	if (tree.phone && !merged.number) {
		if (tree.phone.areacode) merged.areacode = tree.phone.areacode;
		if (tree.phone.number) merged.number = tree.phone.number;
	}

	return mapCompany(merged);
}

/** null when the record has no usable id — the caller must skip it. */
export function mapCompany(record: SageRecord): MappedCompany | null {
	const id = clean(record.companyid);
	// Sibling project: `name` with fallback to `companyname`.
	const name = clean(record.name) ?? clean(record.companyname);
	if (!id || !name) return null;

	const website = clean(record.website);
	const email = normaliseEmail(record.emailaddress);
	return {
		sageCrmCompanyId: id,
		name,
		sage100CustomerNo: clean(record.mas_customerno),
		sage100ArDivisionNo: clean(record.mas_ardivisionno),
		website,
		domain: domainFrom(website) ?? domainFrom(email),
		email,
		phone: joinPhone(record.areacode, record.number),
		city: clean(record.city),
		primaryPersonId: clean(record.primarypersonid),
	};
}

export function mapContact(
	record: SageRecord,
	/** When the person is nested under a company, pass the parent's id. */
	parentCompanyId?: string | null,
): MappedContact | null {
	const id = clean(record.personid);
	const firstName = clean(record.firstname);
	if (!id || !firstName) return null;

	return {
		sageCrmContactId: id,
		sageCrmCompanyId: clean(record.companyid) ?? clean(parentCompanyId),
		firstName,
		lastName: clean(record.lastname),
		email: normaliseEmail(record.emailaddress),
		phone: joinPhone(record.areacode, record.number),
		title: clean(record.title),
	};
}

export type MappedOpportunity = {
	sageCrmOpportunityId: string;
	sageCrmCompanyId: string;
	/** Sage primary person id — linked via `DealContact` when the contact exists. */
	sageCrmPrimaryPersonId: string | null;
	name: string;
	/** Unweighted total — Sage `total`. */
	amount: string | null;
	/** Weighted forecast — Sage `forecast`. */
	weightedAmount: string | null;
	probability: number | null;
	currency: string;
	stage: DealStage;
	sageStage: string | null;
	sageStatus: string | null;
	dealType: string | null;
	expectedCloseDate: Date | null;
	closedAt: Date | null;
	/** Sage `assigneduserid` — resolve via `emailForSageUser` + fallback. */
	sageAssignedUserId: string | null;
};

/**
 * Map a flat Sage opportunity onto local Deal fields (plan §3.3 / §3b).
 *
 * null when there is no usable id, description, or primary company.
 */
export function mapOpportunity(record: SageRecord): MappedOpportunity | null {
	const id = clean(record.opportunityid);
	const name = clean(record.description);
	const companyId = clean(record.primarycompanyid);
	if (!id || !name || !companyId) return null;

	const sageStage = clean(record.stage);
	const sageStatus = clean(record.status);

	return {
		sageCrmOpportunityId: id,
		sageCrmCompanyId: companyId,
		sageCrmPrimaryPersonId: clean(record.primarypersonid),
		name,
		amount: parseDecimal(record.total),
		weightedAmount: parseDecimal(record.forecast),
		probability: parseCertainty(record.certainty),
		currency: clean(record.currency) ?? "USD",
		stage: mapSageDealStage(sageStage, sageStatus),
		sageStage,
		sageStatus,
		dealType: clean(record.type),
		expectedCloseDate: parseSageDate(record.targetclose),
		closedAt: parseSageDate(record.closed),
		sageAssignedUserId: clean(record.assigneduserid),
	};
}

/**
 * Sage stage/status -> existing `DealStage` enum (plan §3.3).
 *
 * Keep the CRM pipeline; store raw Sage values separately for push. Unknown /
 * blank never fails the import — defaults to `QUALIFIED_TO_BUY`.
 */
export function mapSageDealStage(
	sageStage: string | null | undefined,
	sageStatus: string | null | undefined,
): DealStage {
	const stage = clean(sageStage)?.toLowerCase() ?? "";
	const status = clean(sageStatus)?.toLowerCase() ?? "";

	if (stage === "closed won" || status === "won") {
		return DealStage.CLOSED_WON;
	}
	if (
		stage === "lost" ||
		status === "lost" ||
		(status === "closed" && stage !== "closed won")
	) {
		return DealStage.CLOSED_LOST;
	}
	if (stage === "investigation/prospecting") {
		return DealStage.QUALIFIED_TO_BUY;
	}
	if (stage === "proposal" || stage === "purchasing") {
		return DealStage.CONTRACT_SENT;
	}
	if (stage === "negotiation") {
		return DealStage.DECISION_MAKER_BOUGHT_IN;
	}

	return DealStage.QUALIFIED_TO_BUY;
}

/**
 * Sage 100 customer key shown to reps, e.g. "00-0000777".
 *
 * null when the company has no Sage 100 link (a CRM-only company).
 */
export function sage100Display(
	arDivisionNo: string | null,
	customerNo: string | null,
): string | null {
	if (!customerNo) return null;
	return arDivisionNo ? `${arDivisionNo}-${customerNo}` : customerNo;
}

// --- owner mapping ----------------------------------------------------------

/**
 * Sage CRM user id -> email, supplied by the team (2026-08-02).
 *
 * Sage's `user` entity is not exposed over the web service, so we cannot resolve
 * ids to people at runtime. This static map is the resolution instead; the
 * import turns the email into a local `User`. Ids not listed here belong to
 * people who have left — treat them as unknown and fall back to the default
 * owner rather than inventing a mapping. Jordan Johnson intentionally imitates
 * Ken (27) for local testing.
 */
export const SAGE_USER_EMAILS: Readonly<Record<string, string>> = {
	"36": "nbarker@mobilemark.com",
	"49": "cdeano@mobilemark.com",
	"1": "hkim@mobilemark.com",
	"52": "jllorente@mobilemark.com",
	"27": "ken@mobilemark.com",
	"48": "rmiller@mobilemark.com",
	"0": "sales@antenna.com",
	"43": "dsteklac@mobilemark.com",
	"31": "ctalbert@mobilemark.com",
	"51": "muxa@mobilemark.com",
	"28": "swenzelman@mobilemark.com",
};

/**
 * The email a Sage user id maps to, or null when the id is unknown (a former
 * employee we deliberately do not track). The caller applies the fallback owner.
 */
export function emailForSageUser(
	sageUserId: string | null | undefined,
): string | null {
	if (!sageUserId) return null;
	return SAGE_USER_EMAILS[sageUserId.trim()] ?? null;
}

// --- helpers ----------------------------------------------------------------

function clean(value: string | null | undefined): string | null {
	if (value === undefined || value === null) return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function normaliseEmail(value: string | null | undefined): string | null {
	const cleaned = clean(value);
	if (!cleaned) return null;
	// Dirty Sage data: emails arrive wrapped in angle brackets.
	const stripped = cleaned.replace(/^<|>$/g, "").replace(/[<>]/g, "").trim();
	return stripped.length > 0 ? stripped.toLowerCase() : null;
}

function joinPhone(
	areacode: string | null | undefined,
	number: string | null | undefined,
): string | null {
	const parts = [clean(areacode), clean(number)].filter(
		(part): part is string => part !== null,
	);
	return parts.length > 0 ? parts.join(" ") : null;
}

/** Bare host from a website or an email address, lower-cased. */
function domainFrom(value: string | null | undefined): string | null {
	const cleaned = clean(value);
	if (!cleaned) return null;

	const fromEmail = cleaned.includes("@") ? cleaned.split("@").pop() : cleaned;
	if (!fromEmail) return null;

	const host = fromEmail
		.replace(/^https?:\/\//i, "")
		.replace(/^www\./i, "")
		.split("/")[0]
		?.trim()
		.toLowerCase();

	if (!host?.includes(".")) return null;
	return host;
}

/** Decimal string for Prisma, or null when blank / not a number. */
function parseDecimal(value: string | null | undefined): string | null {
	const cleaned = clean(value);
	if (!cleaned) return null;
	const n = Number(cleaned);
	if (!Number.isFinite(n)) return null;
	return cleaned;
}

/** Sage certainty % — integer 0–100, or null. */
function parseCertainty(value: string | null | undefined): number | null {
	const cleaned = clean(value);
	if (!cleaned) return null;
	const n = Number.parseInt(cleaned, 10);
	if (!Number.isFinite(n)) return null;
	return Math.min(100, Math.max(0, n));
}

/** Sage ISO-ish datetime (`2026-07-30T16:50:58`) -> Date, or null. */
function parseSageDate(value: string | null | undefined): Date | null {
	const cleaned = clean(value);
	if (!cleaned) return null;
	const date = new Date(cleaned);
	return Number.isNaN(date.getTime()) ? null : date;
}
