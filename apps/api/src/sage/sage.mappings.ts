import { DealStage } from "@crm/db";
import { domainFromEmail, normalizeDomain } from "../companies/domain";
import { certaintyForStage } from "../deals/deal-stage";
import type { SageWriteField } from "./sage.constants";
import type { SageCompanyTree, SageRecord } from "./sage-xml";

/**
 * Sage -> local field mappings. See `docs/plans/sage-crm-sync.md` section 3.
 *
 * Pure functions over a flattened `SageRecord` (see `sage-xml.ts`). Only fields
 * Sage OWNS are mapped; agent-owned enrichment (logo, industry, brief) is never
 * touched by a pull. Everything is normalised to `string | null` so a blank
 * Sage value becomes a real null rather than an empty string.
 *
 * Sage `website` is often a free-text credit/account note in this tenant
 * ("FORMERLY …", "NET 30 …"), not a URL. Only URL-shaped values are kept.
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
	/** Sage nested `address.address1` (street line). */
	streetAddress: string | null;
	city: string | null;
	stateCode: string | null;
	/** Sage nested `address.postcode` (also accepts `zip` / `zipcode`). */
	postalCode: string | null;
	country: string | null;
	countryCode: string | null;
	/** Sage primary person id, when present — used to set `primaryContactId`. */
	primaryPersonId: string | null;
	/**
	 * Sage `acctmgr` — the account manager as a free-text NAME (e.g.
	 * "Ken F. Lukowski"), not a user id. Resolved to a local owner via
	 * `matchSageUserByName`; unmatched names leave the company owner-less.
	 */
	accountManagerName: string | null;
	/** Sage `updateddate` — used by the push echo-guard on pull. */
	sageUpdatedAt: Date | null;
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
	/** Sage `updateddate` — used by the push echo-guard on pull. */
	sageUpdatedAt: Date | null;
};

/**
 * Map a hierarchical company tree: company scalars plus first nested
 * address / email / phone (Sage association is by nesting, not FK).
 */
export function mapCompanyTree(tree: SageCompanyTree): MappedCompany | null {
	const merged: SageRecord = { ...tree.company };

	if (tree.address) {
		if (!merged.address1 && tree.address.address1) {
			merged.address1 = tree.address.address1;
		}
		if (!merged.city && tree.address.city) merged.city = tree.address.city;
		if (!merged.state && tree.address.state) merged.state = tree.address.state;
		if (!merged.postcode && tree.address.postcode) {
			merged.postcode = tree.address.postcode;
		}
		if (!merged.zip && tree.address.zip) merged.zip = tree.address.zip;
		if (!merged.zipcode && tree.address.zipcode) {
			merged.zipcode = tree.address.zipcode;
		}
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

	const rawWebsite = clean(record.website);
	// Reject Sage "website" notes (terms, formerly-name, do-not-sell, …).
	const website =
		rawWebsite && normalizeDomain(rawWebsite) ? rawWebsite : null;
	const email = normaliseEmail(record.emailaddress);
	const { country, countryCode } = mapCountryFields(record.country);
	return {
		sageCrmCompanyId: id,
		name,
		sage100CustomerNo: clean(record.mas_customerno),
		sage100ArDivisionNo: clean(record.mas_ardivisionno),
		website,
		domain: normalizeDomain(website) ?? domainFromEmail(email),
		email,
		phone: joinPhone(record.areacode, record.number),
		streetAddress: clean(record.address1),
		city: clean(record.city),
		stateCode: mapStateCode(record.state),
		postalCode:
			clean(record.postcode) ?? clean(record.zip) ?? clean(record.zipcode),
		country,
		countryCode,
		primaryPersonId: clean(record.primarypersonid),
		accountManagerName: clean(record.acctmgr),
		sageUpdatedAt: parseSageDate(record.updateddate),
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
		sageUpdatedAt: parseSageDate(record.updateddate),
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
	/** Sage `updateddate` — used by the push echo-guard on pull. */
	sageUpdatedAt: Date | null;
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
	// — always empty or 0). Local certainty is stage-fixed (Mobile Mark bands),
	// not Sage's free-form `certainty` field — weighted = amount × stage %.
	const amount = parseDecimal(record.forecast) ?? parseDecimal(record.total);
	const stage = mapSageDealStage(sageStage, sageStatus);
	const probability = certaintyForStage(stage);

	return {
		sageCrmOpportunityId: id,
		sageCrmCompanyId: companyId,
		sageCrmPrimaryPersonId: clean(record.primarypersonid),
		name,
		amount,
		weightedAmount: weightedAmount(amount, probability),
		probability,
		currency: clean(record.currency) ?? "USD",
		stage,
		sageStage,
		sageStatus,
		dealType: clean(record.type),
		expectedCloseDate: parseSageDate(record.targetclose),
		closedAt: parseSageDate(record.closed),
		openedAt: parseSageDate(record.opened) ?? parseSageDate(record.createddate),
		sageAssignedUserId: clean(record.assigneduserid),
		sageUpdatedAt: parseSageDate(record.updateddate),
	};
}

/**
 * True when a Sage `updateddate` is at/before our last push — i.e. the change
 * we are about to pull is our own write coming back. The pull should skip
 * overwriting local mapped fields in that case (local wins).
 */
export function isPushEcho(
	sageUpdatedAt: Date | null | undefined,
	sagePushedAt: Date | null | undefined,
): boolean {
	if (!sageUpdatedAt || !sagePushedAt) return false;
	return sageUpdatedAt.getTime() <= sagePushedAt.getTime();
}

/**
 * Sage stage/status -> local `DealStage` (plan §3.3).
 *
 * Keep HubSpot-style enum keys; map into Mobile Mark process labels. Unknown /
 * blank never fails the import — defaults to `DEMO_BOOKED` (Leads).
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
	if (stage === "proposal") {
		return DealStage.DECISION_MAKER_BOUGHT_IN;
	}
	if (stage === "negotiation") {
		return DealStage.CONTRACT_SENT;
	}
	if (stage === "purchasing") {
		return DealStage.IN_PURCHASING;
	}

	return DealStage.DEMO_BOOKED;
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

/** Sage CRM user id for a local owner email, or null when not a mapped rep. */
export function sageUserIdForEmail(
	email: string | null | undefined,
): string | null {
	const cleaned = clean(email)?.toLowerCase();
	if (!cleaned) return null;
	for (const user of SAGE_USERS) {
		if (user.email.toLowerCase() === cleaned) return user.sageId;
	}
	return null;
}

// --- push: local -> Sage write fields (plan §3, reversed) -------------------
//
// The inverse of the read mappings above. Each `toSage*Fields` returns the SHORT
// Sage field names a write needs (see `SageWriteField`); an `update` set leads
// with the entity id. Only the fields Sage OWNS in the 1:1 catalog are pushed —
// nested address / phone / email are separate Sage entities and are NOT written
// through a flat company/person update in this cut (noted for a later phase).

/** Local deal values needed to write an opportunity back to Sage. */
export type DealPushInput = {
	sageCrmOpportunityId: string | null;
	name: string;
	/** Unweighted deal value -> Sage `forecast`, decimal string or null. */
	amount: string | null;
	/** 0-100 -> Sage `certainty`. */
	probability: number | null;
	stage: DealStage;
	/** Raw Sage stage/status last pulled — kept for a lossless 1:1 round-trip. */
	sageStage: string | null;
	sageStatus: string | null;
	expectedCloseDate: Date | null;
	/** Local owner's email -> Sage `assigneduserid` when it is a mapped rep. */
	ownerEmail: string | null;
	/** Parent company's Sage id — REQUIRED to create an opportunity in Sage. */
	sageCrmCompanyId: string | null;
	/** Primary contact's Sage id, linked as `primarypersonid` when present. */
	sageCrmPrimaryPersonId: string | null;
};

/**
 * Opportunity write fields for an `update` or `add`.
 *
 * Stage/status: if the raw Sage stage still maps to the local stage, send it
 * back verbatim (lossless — e.g. "Purchasing" is not flattened to "Proposal").
 * Once the rep changes the stage locally, derive the Sage values from the enum.
 */
export function toSageOpportunityFields(
	input: DealPushInput,
	op: "create" | "update",
): SageWriteField[] {
	const fields: SageWriteField[] = [];

	if (op === "update") {
		if (!input.sageCrmOpportunityId) {
			throw new Error("opportunity update needs sageCrmOpportunityId");
		}
		fields.push({ name: "opportunityid", value: input.sageCrmOpportunityId });
	} else {
		if (!input.sageCrmCompanyId) {
			throw new Error("opportunity create needs a parent sageCrmCompanyId");
		}
		fields.push({ name: "primarycompanyid", value: input.sageCrmCompanyId });
		if (input.sageCrmPrimaryPersonId) {
			fields.push({
				name: "primarypersonid",
				value: input.sageCrmPrimaryPersonId,
			});
		}
	}

	fields.push({ name: "description", value: input.name });

	if (input.amount !== null) {
		fields.push({ name: "forecast", value: input.amount });
	}
	if (input.probability !== null) {
		fields.push({ name: "certainty", value: String(input.probability) });
	}
	if (input.expectedCloseDate) {
		fields.push({
			name: "targetclose",
			value: sageDateForPush(input.expectedCloseDate),
		});
	}

	const { stage, status } = sageStageForPush(input);
	fields.push({ name: "stage", value: stage });
	fields.push({ name: "status", value: status });

	const assigned = sageUserIdForEmail(input.ownerEmail);
	if (assigned) fields.push({ name: "assigneduserid", value: assigned });

	return fields;
}

/** Local company values needed to write a company back to Sage. */
export type CompanyPushInput = {
	sageCrmCompanyId: string | null;
	name: string;
};

export function toSageCompanyFields(
	input: CompanyPushInput,
	op: "create" | "update",
): SageWriteField[] {
	const fields: SageWriteField[] = [];
	if (op === "update") {
		if (!input.sageCrmCompanyId) {
			throw new Error("company update needs sageCrmCompanyId");
		}
		fields.push({ name: "companyid", value: input.sageCrmCompanyId });
	}
	fields.push({ name: "name", value: input.name });
	// Never push `website`. In this tenant Sage uses that field for free-text
	// credit/account notes ("FORMERLY …", "NET 30 …"), not URLs. Pushing would
	// overwrite those notes.
	return fields;
}

/** Local contact values needed to write a person back to Sage. */
export type ContactPushInput = {
	sageCrmContactId: string | null;
	firstName: string;
	lastName: string | null;
	title: string | null;
	/** Parent company's Sage id — REQUIRED to create a person in Sage. */
	sageCrmCompanyId: string | null;
};

export function toSagePersonFields(
	input: ContactPushInput,
	op: "create" | "update",
): SageWriteField[] {
	const fields: SageWriteField[] = [];
	if (op === "update") {
		if (!input.sageCrmContactId) {
			throw new Error("person update needs sageCrmContactId");
		}
		fields.push({ name: "personid", value: input.sageCrmContactId });
	} else {
		if (!input.sageCrmCompanyId) {
			throw new Error("person create needs a parent sageCrmCompanyId");
		}
		fields.push({ name: "companyid", value: input.sageCrmCompanyId });
	}
	fields.push({ name: "firstname", value: input.firstName });
	if (input.lastName) fields.push({ name: "lastname", value: input.lastName });
	if (input.title) fields.push({ name: "title", value: input.title });
	return fields;
}

/**
 * Local `DealStage` -> Sage `{ stage, status }`, keeping the raw Sage values
 * when they still describe the current local stage (a lossless round-trip).
 */
export function sageStageForPush(input: {
	stage: DealStage;
	sageStage: string | null;
	sageStatus: string | null;
}): { stage: string; status: string } {
	// Unchanged since the pull: send exactly what Sage gave us.
	if (
		input.sageStage &&
		mapSageDealStage(input.sageStage, input.sageStatus) === input.stage
	) {
		return { stage: input.sageStage, status: input.sageStatus ?? "In Progress" };
	}
	return DEAL_STAGE_TO_SAGE[input.stage];
}

/**
 * The Sage stage/status a local `DealStage` should write when it has diverged
 * from the pulled value (the rep moved the deal). Chosen from the team's active
 * Sage vocabulary (plan §3.3).
 */
const DEAL_STAGE_TO_SAGE: Record<DealStage, { stage: string; status: string }> =
	{
		[DealStage.DEMO_BOOKED]: {
			stage: "Investigation/Prospecting",
			status: "In Progress",
		},
		[DealStage.QUALIFIED_TO_BUY]: {
			stage: "Investigation/Prospecting",
			status: "In Progress",
		},
		[DealStage.DECISION_MAKER_BOUGHT_IN]: {
			stage: "Proposal",
			status: "In Progress",
		},
		[DealStage.CONTRACT_SENT]: {
			stage: "Negotiation",
			status: "In Progress",
		},
		[DealStage.IN_PURCHASING]: {
			stage: "Purchasing",
			status: "In Progress",
		},
		[DealStage.CLOSED_WON]: { stage: "Closed Won", status: "Won" },
		[DealStage.CLOSED_LOST]: { stage: "Lost", status: "Lost" },
		[DealStage.UNQUALIFIED_TO_BUY]: { stage: "Lost", status: "Lost" },
	};

/** A Date as Sage's local ISO-ish datetime, e.g. `2026-07-30T16:50:58`. */
export function sageDateForPush(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
		`T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
	);
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

/** Two-letter US/CA style codes uppercased; longer labels kept as-is. */
function mapStateCode(value: string | null | undefined): string | null {
	const cleaned = clean(value);
	if (!cleaned) return null;
	if (cleaned.length === 2) return cleaned.toUpperCase();
	return cleaned;
}

/**
 * Normalise Sage country strings into display name + ISO-ish code when we can.
 * Unknown values keep the raw label and leave countryCode null.
 */
function mapCountryFields(value: string | null | undefined): {
	country: string | null;
	countryCode: string | null;
} {
	const cleaned = clean(value);
	if (!cleaned) return { country: null, countryCode: null };

	const upper = cleaned.toUpperCase();
	if (
		upper === "US" ||
		upper === "USA" ||
		upper === "UNITED STATES" ||
		upper === "UNITED STATES OF AMERICA"
	) {
		return { country: "United States", countryCode: "US" };
	}
	if (upper === "CA" || upper === "CAN" || upper === "CANADA") {
		return { country: "Canada", countryCode: "CA" };
	}
	if (upper === "MX" || upper === "MEX" || upper === "MEXICO") {
		return { country: "Mexico", countryCode: "MX" };
	}
	if (cleaned.length === 2) {
		return { country: cleaned, countryCode: upper };
	}
	return { country: cleaned, countryCode: null };
}

/**
 * Sage `emailaddress` often holds free-text notes in this tenant
 * ("CORRECT BILLING ADDRESS 4/15/08", "see file for routing…"). Keep only
 * values that look like a real email; notes become null (same idea as
 * URL-only `website`).
 */
export function normaliseEmail(
	value: string | null | undefined,
): string | null {
	const cleaned = clean(value);
	if (!cleaned) return null;
	// Dirty Sage data: emails arrive wrapped in angle brackets.
	const stripped = cleaned.replace(/^<|>$/g, "").replace(/[<>]/g, "").trim();
	if (!stripped) return null;
	const lower = stripped.toLowerCase();
	// Require local@domain.tld — rejects notes, "none", bare domains, etc.
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) return null;
	return lower;
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

/** Sage ISO-ish datetime (`2026-07-30T16:50:58`) -> Date, or null. */
function parseSageDate(value: string | null | undefined): Date | null {
	const cleaned = clean(value);
	if (!cleaned) return null;
	const date = new Date(cleaned);
	return Number.isNaN(date.getTime()) ? null : date;
}
