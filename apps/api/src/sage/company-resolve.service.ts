import { type Db, Prisma } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { normalizeCompanyName } from "../companies/company-name";
import { domainFromEmail, normalizeDomain } from "../companies/domain";
import { InjectDatabase } from "../database/database.constants";

/** Known Sage terms codes → human words (same table the sister app uses). */
const TERMS_LABELS: Record<string, string> = {
	"03": "Net 30",
	"04": "Credit Card",
	"17": "Wire Transfer",
	"22": "ACH",
	"45": "Net 45",
	"60": "Net 60",
};

const AUTO_ACCEPT_MIN = 0.85;
const AMBIGUOUS_GAP = 0.08;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

/** Names that are us (the vendor), never the customer on a PO. */
const VENDOR_NAME_NEEDLES = [
	"mobile mark",
	"mobilemark",
	"mm antennas",
	"mmantenna",
];

const RESOLVE_SELECT = {
	id: true,
	name: true,
	sageCrmCompanyId: true,
	sage100CustomerNo: true,
	streetAddress: true,
	city: true,
	stateCode: true,
	postalCode: true,
	domain: true,
	email: true,
	phone: true,
} satisfies Prisma.CompanyFindFirstArgs["select"];

type ResolveRow = Prisma.CompanyGetPayload<{ select: typeof RESOLVE_SELECT }>;

export type ResolveSignals = {
	mas_customer_no?: string | null;
	buyer_name?: string | null;
	buyer_address?: string | null;
	buyer_zip?: string | null;
	bill_to_name?: string | null;
	bill_to_address?: string | null;
	bill_to_zip?: string | null;
	ship_to_name?: string | null;
	ship_to_address?: string | null;
	ship_to_zip?: string | null;
	email?: string | null;
	email_domain?: string | null;
	phone?: string | null;
	filename_cust_no?: string | null;
};

export type ResolveOptions = {
	limit?: number;
	require_mas_customer_no?: boolean;
	allow_ship_to_as_account?: boolean;
};

export type ResolveCandidate = {
	mas_customer_no: string | null;
	name: string;
	match_confidence: number;
	match_method: string;
	has_mas_id: boolean;
	zip_code: string | null;
	status: string | null;
	company_id: string;
	sage_company_id: string | null;
	address: string | null;
	city: string | null;
	state: string | null;
	terms_code: string | null;
	terms_description: string | null;
};

export type ResolveResult = {
	matched: boolean;
	ambiguous: boolean;
	match_confidence: number | null;
	match_method: string | null;
	mas_customer_no: string | null;
	sage_company_id: string | null;
	company_id: string | null;
	name: string | null;
	terms_code: string | null;
	terms_description: string | null;
	address: string | null;
	city: string | null;
	state: string | null;
	zip_code: string | null;
	status: string | null;
	has_mas_id: boolean;
	candidates: ResolveCandidate[];
	non_mas_candidates: ResolveCandidate[];
	rejected_signals: Array<{ signal: string; reason: string }>;
	fields_used: string[];
};

type Scored = {
	row: ResolveRow;
	score: number;
	methods: string[];
	fields: string[];
	shipToOnly: boolean;
};

/**
 * Ranked company resolve for incomplete PO extracts (letterhead / buyer /
 * email when there is no Bill-To block). Mechanical — returns stored Sage
 * companies only, never invents a MAS number.
 */
@Injectable()
export class CompanyResolveService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async resolve(
		signals: ResolveSignals,
		options: ResolveOptions = {},
	): Promise<ResolveResult> {
		const limit = clampLimit(options.limit);
		const requireMas = options.require_mas_customer_no !== false;
		const allowShipTo = options.allow_ship_to_as_account === true;

		const rejected: ResolveResult["rejected_signals"] = [];
		const empty = emptyResult(rejected);

		const masHint = normalizeMasHint(
			signals.mas_customer_no ?? signals.filename_cust_no,
		);
		const email = clean(signals.email)?.toLowerCase() ?? null;
		const emailDomain =
			normalizeDomain(signals.email_domain) ??
			(email ? domainFromEmail(email) : null);
		const phoneDigits = digitsOnly(signals.phone);

		const buyerName = cleanVendorName(
			signals.buyer_name,
			rejected,
			"buyer_name",
		);
		const billToName = cleanVendorName(
			signals.bill_to_name,
			rejected,
			"bill_to_name",
		);
		const shipToName = clean(signals.ship_to_name);

		if (shipToName && isVendorName(shipToName)) {
			rejected.push({
				signal: "ship_to_name",
				reason: "vendor_name_rejected",
			});
		}
		if (shipToName && !allowShipTo) {
			rejected.push({
				signal: "ship_to_name",
				reason: "drop_ship_not_used_for_auto_match",
			});
		}

		const buyerZip = zipPrefix(signals.buyer_zip);
		const billToZip = zipPrefix(signals.bill_to_zip);
		const shipToZip = zipPrefix(signals.ship_to_zip);

		const scored = new Map<string, Scored>();

		const add = (
			rows: ResolveRow[],
			score: number,
			method: string,
			fields: string[],
			shipToOnly = false,
		) => {
			for (const row of rows) {
				if (isVendorName(row.name)) continue;
				const existing = scored.get(row.id);
				if (!existing) {
					scored.set(row.id, {
						row,
						score,
						methods: [method],
						fields: [...fields],
						shipToOnly,
					});
					continue;
				}
				if (score > existing.score) {
					existing.score = score;
					existing.methods = [
						method,
						...existing.methods.filter((m) => m !== method),
					];
				} else if (!existing.methods.includes(method)) {
					// Secondary corroborating signal — small boost, cap at 1.
					existing.score = Math.min(1, existing.score + 0.05);
					existing.methods.push(method);
				}
				for (const field of fields) {
					if (!existing.fields.includes(field)) existing.fields.push(field);
				}
				// Once a stronger non-ship signal hits, it is no longer ship-only.
				if (!shipToOnly) existing.shipToOnly = false;
			}
		};

		// 1. MAS / filename customer number (exact + zero-padded).
		if (masHint) {
			const masField = signals.mas_customer_no?.trim()
				? "mas_customer_no"
				: "filename_cust_no";
			const rows = await this.findByMasVariants(masHint);
			add(rows, 1, "mas_customer_no", [masField]);
		}

		// 2. Email exact, then domain.
		if (email) {
			const byEmail = await this.findByContactEmail(email);
			add(byEmail, 0.95, "email", ["email"]);
		}
		if (emailDomain) {
			const byDomain = await this.findByDomain(emailDomain);
			add(byDomain, 0.88, "email_domain", ["email_domain"]);
		}

		// 3. Buyer (letterhead) name + zip.
		if (buyerName) {
			const rows = await this.findByName(buyerName);
			const boosted = applyZipBoost(rows, buyerZip, 0.82, 0.7);
			add(
				boosted.rows,
				boosted.score,
				boosted.zipHit ? "buyer_name+zip" : "buyer_name",
				boosted.zipHit ? ["buyer_name", "buyer_zip"] : ["buyer_name"],
			);
		}

		// 4. Classic bill-to.
		if (billToName) {
			const rows = await this.findByName(billToName);
			const boosted = applyZipBoost(rows, billToZip, 0.8, 0.68);
			add(
				boosted.rows,
				boosted.score,
				boosted.zipHit ? "bill_to_name+zip" : "bill_to_name",
				boosted.zipHit ? ["bill_to_name", "bill_to_zip"] : ["bill_to_name"],
			);
		}

		// 5. Phone.
		if (phoneDigits && phoneDigits.length >= 7) {
			const byPhone = await this.findByPhone(phoneDigits);
			add(byPhone, 0.75, "phone", ["phone"]);
		}

		// 6. Ship-to — candidates only unless explicitly allowed.
		if (shipToName && !isVendorName(shipToName)) {
			const rows = await this.findByName(shipToName);
			const boosted = applyZipBoost(rows, shipToZip, 0.55, 0.45);
			add(
				boosted.rows,
				boosted.score,
				boosted.zipHit ? "ship_to_name+zip" : "ship_to_name",
				boosted.zipHit ? ["ship_to_name", "ship_to_zip"] : ["ship_to_name"],
				!allowShipTo,
			);
		}

		if (scored.size === 0) return empty;

		const all = [...scored.values()].sort((a, b) => b.score - a.score);
		const withMas = all.filter((s) => Boolean(s.row.sage100CustomerNo));
		const withoutMas = all.filter((s) => !s.row.sage100CustomerNo);

		const primaryPool = requireMas ? withMas : all;
		if (primaryPool.length === 0) {
			return {
				...empty,
				non_mas_candidates: await this.toCandidates(withoutMas.slice(0, limit)),
				rejected_signals: rejected,
			};
		}

		const top = primaryPool.slice(0, limit);
		const candidates = await this.toCandidates(top);
		const nonMasCandidates = requireMas
			? await this.toCandidates(withoutMas.slice(0, limit))
			: [];

		const best = top[0];
		const bestCandidate = candidates[0];
		if (!best || !bestCandidate) return empty;

		const second = top[1];
		const shipOnlyBlock = best.shipToOnly && !allowShipTo;
		const closeSecond =
			second !== undefined && best.score - second.score < AMBIGUOUS_GAP;
		const autoAccept =
			best.score >= AUTO_ACCEPT_MIN &&
			Boolean(best.row.sage100CustomerNo) &&
			!shipOnlyBlock &&
			!closeSecond;

		const fieldsUsed = unique(best.fields);

		if (!autoAccept) {
			return {
				matched: false,
				ambiguous: top.length > 1 || closeSecond || shipOnlyBlock,
				match_confidence: bestCandidate.match_confidence,
				match_method: bestCandidate.match_method,
				mas_customer_no: null,
				sage_company_id: null,
				company_id: null,
				name: null,
				terms_code: null,
				terms_description: null,
				address: null,
				city: null,
				state: null,
				zip_code: null,
				status: null,
				has_mas_id: false,
				candidates,
				non_mas_candidates: nonMasCandidates,
				rejected_signals: rejected,
				fields_used: fieldsUsed,
			};
		}

		return {
			matched: true,
			ambiguous: false,
			match_confidence: bestCandidate.match_confidence,
			match_method: bestCandidate.match_method,
			mas_customer_no: bestCandidate.mas_customer_no,
			sage_company_id: bestCandidate.sage_company_id,
			company_id: bestCandidate.company_id,
			name: bestCandidate.name,
			terms_code: bestCandidate.terms_code,
			terms_description: bestCandidate.terms_description,
			address: bestCandidate.address,
			city: bestCandidate.city,
			state: bestCandidate.state,
			zip_code: bestCandidate.zip_code,
			status: bestCandidate.status,
			has_mas_id: true,
			candidates,
			non_mas_candidates: nonMasCandidates,
			rejected_signals: rejected,
			fields_used: fieldsUsed,
		};
	}

	/** Name-only / email-domain / phone soft lookup for order-defaults. */
	async softLookup(input: {
		name?: string;
		zip?: string;
		emailDomain?: string;
		phone?: string;
		limit?: number;
	}): Promise<ResolveResult> {
		const signals: ResolveSignals = {
			buyer_name: input.name ?? null,
			buyer_zip: input.zip ?? null,
			email_domain: input.emailDomain ?? null,
			phone: input.phone ?? null,
		};
		return this.resolve(signals, {
			limit: input.limit ?? DEFAULT_LIMIT,
			require_mas_customer_no: true,
			allow_ship_to_as_account: false,
		});
	}

	private async findByMasVariants(hint: string): Promise<ResolveRow[]> {
		const variants = masVariants(hint);
		if (variants.length === 0) return [];
		return this.db.company.findMany({
			where: { sage100CustomerNo: { in: variants } },
			select: RESOLVE_SELECT,
			take: 10,
		});
	}

	private async findByContactEmail(email: string): Promise<ResolveRow[]> {
		const contacts = await this.db.contact.findMany({
			where: { email: { equals: email, mode: "insensitive" } },
			select: { companyId: true },
			take: 10,
		});
		const ids = unique(
			contacts
				.map((c) => c.companyId)
				.filter((id): id is string => Boolean(id)),
		);
		if (ids.length === 0) return [];
		return this.db.company.findMany({
			where: { id: { in: ids } },
			select: RESOLVE_SELECT,
		});
	}

	private async findByDomain(domain: string): Promise<ResolveRow[]> {
		const [byCompanyDomain, byContact] = await Promise.all([
			this.db.company.findMany({
				where: { domain },
				select: RESOLVE_SELECT,
				take: 20,
			}),
			this.db.contact.findMany({
				where: { email: { endsWith: `@${domain}`, mode: "insensitive" } },
				select: { companyId: true },
				take: 40,
			}),
		]);
		const ids = unique([
			...byCompanyDomain.map((r) => r.id),
			...byContact
				.map((c) => c.companyId)
				.filter((id): id is string => Boolean(id)),
		]);
		if (ids.length === 0) return byCompanyDomain;
		const extra = await this.db.company.findMany({
			where: { id: { in: ids } },
			select: RESOLVE_SELECT,
		});
		return uniqueById([...byCompanyDomain, ...extra]);
	}

	private async findByName(name: string): Promise<ResolveRow[]> {
		const normalized = normalizeCompanyName(name);
		if (!normalized || normalized.length < 2) return [];

		// Short tokens ("MCL") need a wider net — Prisma contains is case-insensitive.
		const rows = await this.db.company.findMany({
			where: {
				name: { contains: name.trim(), mode: "insensitive" },
			},
			select: RESOLVE_SELECT,
			take: 40,
		});

		return rows.filter((row) => {
			const candidate = normalizeCompanyName(row.name);
			if (!candidate) return false;
			if (candidate === normalized) return true;
			const compact = candidate.replace(/\s+/g, "");
			const needle = normalized.replace(/\s+/g, "");
			if (needle.length <= 4) {
				// Word-boundary-ish for short letterhead tokens.
				return (
					candidate === needle ||
					candidate.startsWith(`${needle} `) ||
					candidate.includes(` ${needle} `) ||
					compact === needle ||
					compact.startsWith(needle)
				);
			}
			return (
				candidate.includes(normalized) ||
				normalized.includes(candidate) ||
				compact.includes(needle) ||
				needle.includes(compact)
			);
		});
	}

	private async findByPhone(phoneDigits: string): Promise<ResolveRow[]> {
		const suffix = phoneDigits.slice(-10);
		// Digit-normalized match — phones are stored with spaces/dashes.
		const companyIds = await this.db.$queryRaw<{ id: string }[]>`
			SELECT c.id
			FROM company c
			WHERE c.phone IS NOT NULL
			  AND regexp_replace(c.phone, '\D', '', 'g') LIKE ${`%${suffix}`}
			LIMIT 20
		`;
		const contactCompanyIds = await this.db.$queryRaw<{ id: string }[]>`
			SELECT DISTINCT co.id
			FROM contact ct
			JOIN company co ON co.id = ct."companyId"
			WHERE ct.phone IS NOT NULL
			  AND regexp_replace(ct.phone, '\D', '', 'g') LIKE ${`%${suffix}`}
			LIMIT 20
		`;
		const ids = unique([
			...companyIds.map((r) => r.id),
			...contactCompanyIds.map((r) => r.id),
		]);
		if (ids.length === 0) return [];
		return this.db.company.findMany({
			where: { id: { in: ids } },
			select: RESOLVE_SELECT,
		});
	}

	private async toCandidates(scored: Scored[]): Promise<ResolveCandidate[]> {
		const termsBySageId = await this.termsAndStatus(
			scored.map((s) => s.row.sageCrmCompanyId).filter(Boolean) as string[],
		);

		return scored.map((s) => {
			const meta = s.row.sageCrmCompanyId
				? termsBySageId.get(s.row.sageCrmCompanyId)
				: undefined;
			const termsCode = meta?.termsCode ?? null;
			return {
				mas_customer_no: s.row.sage100CustomerNo,
				name: s.row.name,
				match_confidence: round2(s.score),
				match_method: s.methods.join("+"),
				has_mas_id: Boolean(s.row.sage100CustomerNo),
				zip_code: s.row.postalCode,
				status: meta?.status ?? null,
				company_id: s.row.id,
				sage_company_id: s.row.sageCrmCompanyId,
				address: s.row.streetAddress,
				city: s.row.city,
				state: s.row.stateCode,
				terms_code: termsCode,
				terms_description: termsCode ? (TERMS_LABELS[termsCode] ?? null) : null,
			};
		});
	}

	private async termsAndStatus(
		sageIds: string[],
	): Promise<Map<string, { termsCode: string | null; status: string | null }>> {
		const map = new Map<
			string,
			{ termsCode: string | null; status: string | null }
		>();
		if (sageIds.length === 0) return map;

		const snapshots = await this.db.sageRecordSnapshot.findMany({
			where: {
				entity: "company",
				sageId: { in: sageIds },
			},
			select: { sageId: true, payload: true },
		});

		for (const snap of snapshots) {
			const company = (snap.payload as { company?: Record<string, unknown> })
				.company;
			const rawTerms = company?.mas_termscode;
			const termsCode =
				typeof rawTerms === "string" && rawTerms.trim()
					? rawTerms.trim()
					: null;
			const rawStatus = company?.status ?? company?.type;
			const status =
				typeof rawStatus === "string" && rawStatus.trim()
					? rawStatus.trim()
					: null;
			map.set(snap.sageId, { termsCode, status });
		}
		return map;
	}
}

function emptyResult(
	rejected: ResolveResult["rejected_signals"],
): ResolveResult {
	return {
		matched: false,
		ambiguous: false,
		match_confidence: null,
		match_method: null,
		mas_customer_no: null,
		sage_company_id: null,
		company_id: null,
		name: null,
		terms_code: null,
		terms_description: null,
		address: null,
		city: null,
		state: null,
		zip_code: null,
		status: null,
		has_mas_id: false,
		candidates: [],
		non_mas_candidates: [],
		rejected_signals: rejected,
		fields_used: [],
	};
}

function clean(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

function cleanVendorName(
	value: string | null | undefined,
	rejected: ResolveResult["rejected_signals"],
	signal: string,
): string | null {
	const name = clean(value);
	if (!name) return null;
	if (isVendorName(name)) {
		rejected.push({ signal, reason: "vendor_name_rejected" });
		return null;
	}
	return name;
}

function isVendorName(name: string): boolean {
	const normalized = normalizeCompanyName(name);
	if (!normalized) return false;
	return VENDOR_NAME_NEEDLES.some(
		(needle) =>
			normalized === needle ||
			normalized.startsWith(`${needle} `) ||
			normalized.includes(` ${needle}`),
	);
}

function normalizeMasHint(value: string | null | undefined): string | null {
	const digits = digitsOnly(value);
	if (!digits || digits.length < 3 || digits.length > 8) return null;
	return digits;
}

function masVariants(hint: string): string[] {
	const out = new Set<string>([hint]);
	if (hint.length < 7) out.add(hint.padStart(7, "0"));
	if (hint.length < 8) out.add(hint.padStart(8, "0"));
	// Strip leading zeros for the rare short stored values.
	const stripped = hint.replace(/^0+/, "") || "0";
	if (stripped !== hint) out.add(stripped);
	return [...out];
}

function zipPrefix(value: string | null | undefined): string | null {
	const digits = digitsOnly(value);
	if (!digits || digits.length < 5) return null;
	return digits.slice(0, 5);
}

function digitsOnly(value: string | null | undefined): string | null {
	if (!value) return null;
	const digits = value.replace(/\D/g, "");
	return digits.length > 0 ? digits : null;
}

function applyZipBoost(
	rows: ResolveRow[],
	zip: string | null,
	withZip: number,
	withoutZip: number,
): { rows: ResolveRow[]; score: number; zipHit: boolean } {
	if (!zip || rows.length === 0) {
		return { rows, score: withoutZip, zipHit: false };
	}
	const matched = rows.filter((row) => zipPrefix(row.postalCode) === zip);
	if (matched.length > 0) {
		return { rows: matched, score: withZip, zipHit: true };
	}
	return { rows, score: withoutZip, zipHit: false };
}

function clampLimit(limit: number | undefined): number {
	if (limit === undefined || Number.isNaN(limit)) return DEFAULT_LIMIT;
	return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

function unique<T>(values: T[]): T[] {
	return [...new Set(values)];
}

function uniqueById(rows: ResolveRow[]): ResolveRow[] {
	const seen = new Set<string>();
	const out: ResolveRow[] = [];
	for (const row of rows) {
		if (seen.has(row.id)) continue;
		seen.add(row.id);
		out.push(row);
	}
	return out;
}
