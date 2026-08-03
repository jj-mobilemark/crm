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
	/**
	 * Sage `acctmgr` — the account manager as a free-text NAME (e.g.
	 * "Ken F. Lukowski"), not a user id. Resolved to a local owner via
	 * `matchSageUserByName`; unmatched names leave the company owner-less.
	 */
	accountManagerName: string | null;
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
		accountManagerName: clean(record.acctmgr),
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
	/**
	 * Unweighted deal value. Sage `forecast` holds this for the team (their
	 * `total`/quote field is unused, always empty or 0); fall back to `total`.
	 */
	amount: string | null;
	/** Weighted forecast = `amount` × `certainty`%, computed (Sage has no field). */
	weightedAmount: string | null;
	probability: number | null;
	currency: string;
	stage: DealStage;
	sageStage: string | null;
	sageStatus: string | null;
	dealType: string | null;
	expectedCloseDate: Date | null;
	closedAt: Date | null;
	/** Sage `opened` (else `createddate`) — the real deal creation date. */
	openedAt: Date | null;
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

	// The team enters the deal value in Sage `forecast` (their `total` is unused
	// — always empty or 0), with a separate `certainty` %. So `forecast` is the
	// unweighted value; the weighted forecast is that times the certainty.
	const amount = parseDecimal(record.forecast) ?? parseDecimal(record.total);
	const probability = parseCertainty(record.certainty);

	return {
		sageCrmOpportunityId: id,
		sageCrmCompanyId: companyId,
		sageCrmPrimaryPersonId: clean(record.primarypersonid),
		name,
		amount,
		weightedAmount: weightedAmount(amount, probability),
		probability,
		currency: clean(record.currency) ?? "USD",
		stage: mapSageDealStage(sageStage, sageStatus),
		sageStage,
		sageStatus,
		dealType: clean(record.type),
		expectedCloseDate: parseSageDate(record.targetclose),
		closedAt: parseSageDate(record.closed),
		openedAt: parseSageDate(record.opened) ?? parseSageDate(record.createddate),
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
 * Sage 100 customer key shown to reps, e.g. "0011246".
 *
 * The AR division (always "00" here) is not used by the team, so only the
 * customer number is surfaced. The division is still stored on the company for
 * the Sage 100 -> MasHeader order-history join (plan §3.1 / §8). `arDivisionNo`
 * is kept in the signature but intentionally ignored.
 *
 * null when the company has no Sage 100 link (a CRM-only company).
 */
export function sage100Display(
	_arDivisionNo: string | null,
	customerNo: string | null,
): string | null {
	return customerNo ?? null;
}

// --- owner mapping ----------------------------------------------------------

/** One Sage CRM user — the owner behind an `assigneduserid`. */
export type SageUser = {
	/** Sage CRM `userid`, as a string (e.g. "27"). */
	sageId: string;
	firstName: string;
	lastName: string;
	email: string;
};

/**
 * The Sage CRM users, supplied by the team (2026-08-02).
 *
 * Sage's `user` entity is not exposed over the web service, so we cannot resolve
 * ids to people at runtime. This static list is the resolution instead; the
 * backfill pre-creates each as a local `User` (see `ensureSageUsers`) so a deal
 * always has a real owner to point at. Ids not listed here belong to people who
 * have left — treat them as unknown and fall back to the default owner rather
 * than inventing a mapping. Jordan Johnson intentionally imitates Ken (27) for
 * local testing.
 *
 * `sales@antenna.com` (id 0) is not a `mobilemark.com` address, so it cannot
 * sign in through the allow-list, but it can still own imported deals.
 */
export const SAGE_USERS: readonly SageUser[] = [
	{ sageId: "36", firstName: "Nino", lastName: "Barker", email: "nbarker@mobilemark.com" },
	{ sageId: "49", firstName: "Chris", lastName: "Deaño", email: "cdeano@mobilemark.com" },
	{ sageId: "1", firstName: "Harry", lastName: "Kim", email: "hkim@mobilemark.com" },
	{ sageId: "52", firstName: "Jose", lastName: "Llorente", email: "jllorente@mobilemark.com" },
	{ sageId: "27", firstName: "Ken", lastName: "Lukowski", email: "ken@mobilemark.com" },
	{ sageId: "48", firstName: "Rick", lastName: "Miller", email: "rmiller@mobilemark.com" },
	{ sageId: "0", firstName: "Demo", lastName: "Sales", email: "sales@antenna.com" },
	{ sageId: "43", firstName: "Daniel", lastName: "Steklac", email: "dsteklac@mobilemark.com" },
	{ sageId: "31", firstName: "Chris", lastName: "Talbert", email: "ctalbert@mobilemark.com" },
	{ sageId: "51", firstName: "Mike", lastName: "Uxa", email: "muxa@mobilemark.com" },
	{ sageId: "28", firstName: "Sarah", lastName: "Wenzelman", email: "swenzelman@mobilemark.com" },
] as const;

/**
 * Sage CRM user id -> email, derived from `SAGE_USERS` so the two never drift.
 */
export const SAGE_USER_EMAILS: Readonly<Record<string, string>> =
	Object.fromEntries(SAGE_USERS.map((user) => [user.sageId, user.email]));

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

/**
 * Resolve a free-text account-manager name (Sage `acctmgr`) to one of the known
 * `SAGE_USERS`, or null when it is not one of the team's 11 reps.
 *
 * Company owner in Sage is a display NAME, not a user id, and it is messy:
 * middle initials ("Ken F. Lukowski"), blanks, junk ("Sale Rep Name"), and
 * former reps not in our list (Wallgren / Sertich / Moore). We match on the
 * unique last name plus the first-name initial, so a former rep never collides
 * with a current one and an unmatched name deliberately stays owner-less.
 */
export function matchSageUserByName(
	name: string | null | undefined,
): SageUser | null {
	const cleaned = clean(name);
	if (!cleaned) return null;

	const tokens = foldAccents(cleaned).toLowerCase().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return null;
	const firstToken = tokens[0] ?? "";

	for (const user of SAGE_USERS) {
		const last = foldAccents(user.lastName).toLowerCase();
		const firstInitial = foldAccents(user.firstName).toLowerCase()[0] ?? "";
		if (tokens.includes(last) && firstToken[0] === firstInitial) {
			return user;
		}
	}
	return null;
}

/** The email of the account manager, or null when the name is unmatched. */
export function emailForAcctMgr(name: string | null | undefined): string | null {
	return matchSageUserByName(name)?.email ?? null;
}

// --- helpers ----------------------------------------------------------------

/** Strip diacritics so "Deaño" matches "Deano" (NFD + drop combining marks). */
function foldAccents(value: string): string {
	return value.normalize("NFD").replace(/\p{Mn}/gu, "");
}

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

/**
 * Weighted value = amount × certainty%, as a decimal string (or null).
 *
 * null when there is no amount or no certainty — we do not fabricate a weight.
 */
function weightedAmount(
	amount: string | null,
	certainty: number | null,
): string | null {
	if (amount === null || certainty === null) return null;
	const n = Number(amount);
	if (!Number.isFinite(n)) return null;
	// Round to cents, then drop a trailing ".00"/".x0" for a clean decimal string.
	return String(Math.round(((n * certainty) / 100) * 100) / 100);
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
