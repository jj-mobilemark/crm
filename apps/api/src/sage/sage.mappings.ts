import type { SageRecord } from "./sage-xml";

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

/** null when the record has no usable id — the caller must skip it. */
export function mapCompany(record: SageRecord): MappedCompany | null {
	const id = clean(record.companyid);
	const name = clean(record.name);
	if (!id || !name) return null;

	const website = clean(record.website);
	return {
		sageCrmCompanyId: id,
		name,
		sage100CustomerNo: clean(record.mas_customerno),
		sage100ArDivisionNo: clean(record.mas_ardivisionno),
		website,
		domain: domainFrom(website) ?? domainFrom(clean(record.emailaddress)),
		email: normaliseEmail(record.emailaddress),
		phone: joinPhone(record.areacode, record.number),
		city: clean(record.city),
	};
}

export function mapContact(record: SageRecord): MappedContact | null {
	const id = clean(record.personid);
	const firstName = clean(record.firstname);
	if (!id || !firstName) return null;

	return {
		sageCrmContactId: id,
		sageCrmCompanyId: clean(record.companyid),
		firstName,
		lastName: clean(record.lastname),
		email: normaliseEmail(record.emailaddress),
		phone: joinPhone(record.areacode, record.number),
		title: clean(record.title),
	};
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
	return cleaned ? cleaned.toLowerCase() : null;
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
