import type { Db, Prisma } from "@crm/db";
import { normalizeCompanyName } from "./company-name";
import { hostsRelated } from "./company-name-guess";
import { normalizeDomain } from "./domain";

export type SimilarCandidate = {
	id: string;
	name: string;
	domain: string | null;
	city: string | null;
	stateCode: string | null;
	iconUrl: string | null;
	sageCrmCompanyId: string | null;
	sage100CustomerNo: string | null;
	/** Total contacts on the company. */
	contactCount: number;
	/** Contacts whose email uses the typed/harvested domain. */
	matchingDomainContactCount: number;
};

export type SimilarMatch = SimilarCandidate & {
	score: number;
	reason: "domain" | "name";
	blocksCreate: boolean;
	/** Best pick among the returned matches (UI + soft auto-attach). */
	suggested: boolean;
	/** Short human reason, e.g. "Sage 100 · 12 contacts on hitachirail-cd.com". */
	suggestReason: string | null;
};

/**
 * Score a candidate against the typed name/domain. Returns null when the hit
 * is too weak to bother a human with.
 */
export function rankSimilar(
	row: SimilarCandidate,
	input: { domain: string | null; normalized: string },
): Omit<SimilarMatch, "suggested" | "suggestReason"> | null {
	if (input.domain && row.domain === input.domain) {
		return {
			...row,
			score: 100,
			reason: "domain",
			blocksCreate: true,
		};
	}

	// Related hosts (hitachirail.com ↔ hitachirail-cd.com) — strong family hit,
	// but not a hard create block (domains still differ).
	if (input.domain && row.domain && hostsRelated(input.domain, row.domain)) {
		return {
			...row,
			score: 85,
			reason: "domain",
			blocksCreate: false,
		};
	}

	const candidate = normalizeCompanyName(row.name);
	if (!input.normalized || !candidate) return null;

	if (candidate === input.normalized) {
		return {
			...row,
			score: 90,
			reason: "name",
			blocksCreate: false,
		};
	}

	// Compact form: "hitachi rail" ↔ "hitachirail" / "hitachirail cd".
	const candidateCompact = candidate.replace(/\s+/g, "");
	const inputCompact = input.normalized.replace(/\s+/g, "");
	if (
		candidateCompact.length >= 6 &&
		inputCompact.length >= 6 &&
		(candidateCompact === inputCompact ||
			candidateCompact.includes(inputCompact) ||
			inputCompact.includes(candidateCompact))
	) {
		return {
			...row,
			score: 75,
			reason: "name",
			blocksCreate: false,
		};
	}

	// One normalised name contains the other — "Acme" vs "Acme Widgets".
	const shorter =
		candidate.length <= input.normalized.length ? candidate : input.normalized;
	const longer =
		candidate.length > input.normalized.length ? candidate : input.normalized;
	if (shorter.length >= 3 && longer.includes(shorter)) {
		return {
			...row,
			score: 70,
			reason: "name",
			blocksCreate: false,
		};
	}

	const inputTokens = new Set(
		input.normalized.split(" ").filter((token) => token.length >= 3),
	);
	const rowTokens = candidate.split(" ").filter((token) => token.length >= 3);
	if (inputTokens.size === 0 || rowTokens.length === 0) return null;

	const overlap = rowTokens.filter((token) => inputTokens.has(token)).length;
	const needed = Math.ceil(inputTokens.size * 0.6);
	if (overlap >= needed && overlap >= 1) {
		return {
			...row,
			score: 50 + overlap * 5,
			reason: "name",
			blocksCreate: false,
		};
	}

	return null;
}

/**
 * Prefer real accounts when several name hits look alike.
 *
 * Order of weight: Sage 100 link → contacts on the typed domain → related /
 * same company domain → contact volume → name/domain similarity score.
 */
export function recommendationScore(
	row: Pick<
		SimilarMatch,
		| "sage100CustomerNo"
		| "matchingDomainContactCount"
		| "domain"
		| "contactCount"
		| "score"
	>,
	domain: string | null,
): number {
	let score = 0;
	if (row.sage100CustomerNo) score += 1_000;
	score += row.matchingDomainContactCount * 100;
	if (domain && row.domain === domain) score += 500;
	else if (domain && row.domain && hostsRelated(domain, row.domain)) score += 200;
	score += Math.min(row.contactCount, 500);
	score += row.score;
	return score;
}

export function suggestReasonFor(
	row: Pick<
		SimilarMatch,
		| "sage100CustomerNo"
		| "matchingDomainContactCount"
		| "contactCount"
		| "domain"
	>,
	domain: string | null,
): string {
	const parts: string[] = [];
	if (row.sage100CustomerNo) parts.push("Sage 100");
	if (domain && row.matchingDomainContactCount > 0) {
		const n = row.matchingDomainContactCount;
		parts.push(`${n} contact${n === 1 ? "" : "s"} on ${domain}`);
	} else if (row.contactCount > 0) {
		const n = row.contactCount;
		parts.push(`${n} contact${n === 1 ? "" : "s"}`);
	}
	if (domain && row.domain === domain) parts.push("same domain");
	else if (domain && row.domain && hostsRelated(domain, row.domain)) {
		parts.push("related domain");
	}
	return parts.join(" · ") || "Best name match";
}

/**
 * Mark the best account-backed pick and put it first for the dialog.
 */
export function applySuggestion(
	matches: Array<Omit<SimilarMatch, "suggested" | "suggestReason">>,
	domain: string | null,
): SimilarMatch[] {
	if (matches.length === 0) return [];

	const scored = matches.map((match) => ({
		match,
		rec: recommendationScore(match, domain),
	}));
	scored.sort(
		(a, b) =>
			b.rec - a.rec || b.match.score - a.match.score || a.match.name.localeCompare(b.match.name),
	);

	const best = scored[0]!;
	const second = scored[1];
	const clearLead = !second || best.rec - second.rec >= 50;
	const hasSignal =
		Boolean(best.match.sage100CustomerNo) ||
		best.match.matchingDomainContactCount > 0 ||
		(domain !== null && best.match.domain === domain) ||
		scored.length === 1;

	const suggestedId =
		clearLead || hasSignal ? best.match.id : null;
	const reason =
		suggestedId === best.match.id
			? suggestReasonFor(best.match, domain)
			: null;

	return scored.map(({ match }) => ({
		...match,
		suggested: match.id === suggestedId,
		suggestReason: match.id === suggestedId ? reason : null,
	}));
}

/**
 * Top match is strong and unique enough to auto-attach without a human.
 * Threshold: score ≥ 70 and either sole match, ≥ 15 gap vs 2nd, or a
 * suggested pick with Sage 100 / matching-domain contacts.
 */
export function pickStrongUniqueMatch(
	ranked: SimilarMatch[],
): SimilarMatch | null {
	const eligible = ranked.filter((row) => row.score >= 70);
	if (eligible.length === 0) return null;

	const byScore = [...eligible].toSorted(
		(a, b) => b.score - a.score || a.name.localeCompare(b.name),
	);
	const top = byScore[0]!;
	const second = byScore[1];
	if (!second || top.score - second.score >= 15) return top;

	const suggested = ranked.find((row) => row.suggested);
	if (
		suggested &&
		suggested.score >= 70 &&
		(suggested.sage100CustomerNo || suggested.matchingDomainContactCount > 0)
	) {
		return suggested;
	}

	return null;
}

/**
 * Shared soft-match used by New company, Screening, and companyForEmail.
 */
export async function findSimilarCompanies(
	db: Db,
	input: { name: string; domain?: string | null },
): Promise<SimilarMatch[]> {
	const name = input.name.trim();
	const domain = normalizeDomain(input.domain);
	const normalized = normalizeCompanyName(name);

	if (!name) return [];

	const tokens = normalized
		.split(" ")
		.filter((token) => token.length >= 3)
		.toSorted((a, b) => b.length - a.length)
		.slice(0, 3);

	// Long undivided tokens ("hitachirail") rarely appear in spaced names
	// ("Hitachi Rail") — also search a 7-char stem so the candidate is fetched.
	const stems = tokens.flatMap((token) =>
		token.length >= 8 ? [token.slice(0, 7)] : [],
	);

	const terms = [...new Set([name, ...tokens, ...stems])];
	const or: Prisma.CompanyWhereInput[] = [];
	if (domain) or.push({ domain });
	for (const term of terms) {
		or.push({ name: { contains: term, mode: "insensitive" } });
	}

	// Also pull companies whose domain shares the guessed SLD token so related
	// hosts surface even when the company name does not contain that token.
	if (domain) {
		const sld = domain.split(".")[0];
		if (sld && sld.length >= 6) {
			const stem = sld.split("-")[0] ?? sld;
			if (stem.length >= 6) {
				or.push({ domain: { contains: stem, mode: "insensitive" } });
			}
		}
	}

	const rows = await db.company.findMany({
		where: { OR: or },
		select: {
			id: true,
			name: true,
			domain: true,
			city: true,
			stateCode: true,
			iconUrl: true,
			sageCrmCompanyId: true,
			sage100CustomerNo: true,
			_count: { select: { contacts: true } },
		},
		take: 40,
	});

	const matchingByCompany = new Map<string, number>();
	if (domain && rows.length > 0) {
		const matching = await db.contact.groupBy({
			by: ["companyId"],
			where: {
				companyId: { in: rows.map((row) => row.id) },
				email: { endsWith: `@${domain}`, mode: "insensitive" },
			},
			_count: { _all: true },
		});
		for (const row of matching) {
			if (row.companyId) matchingByCompany.set(row.companyId, row._count._all);
		}
	}

	const ranked = rows
		.map((row) =>
			rankSimilar(
				{
					id: row.id,
					name: row.name,
					domain: row.domain,
					city: row.city,
					stateCode: row.stateCode,
					iconUrl: row.iconUrl,
					sageCrmCompanyId: row.sageCrmCompanyId,
					sage100CustomerNo: row.sage100CustomerNo,
					contactCount: row._count.contacts,
					matchingDomainContactCount: matchingByCompany.get(row.id) ?? 0,
				},
				{ domain, normalized },
			),
		)
		.filter(
			(row): row is Omit<SimilarMatch, "suggested" | "suggestReason"> =>
				row !== null,
		);

	return applySuggestion(ranked, domain).slice(0, 8);
}
