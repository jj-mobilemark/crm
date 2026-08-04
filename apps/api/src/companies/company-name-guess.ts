import { normalizeDomain } from "./domain";

/**
 * Turn an email domain into a name guess for soft company matching.
 *
 * `hitachirail-cd.com` → `hitachirail cd` so `companies.similar` can find
 * "Hitachi Rail" via token overlap.
 */
export function companyNameGuessFromDomain(
	domain: string | null | undefined,
): string {
	const host = normalizeDomain(domain) ?? domain?.trim().toLowerCase() ?? "";
	if (!host) return "";

	const labels = host.split(".");
	// Drop the final public label (`.com`, `.net`, …). Multi-part TLDs
	// (`.co.uk`) keep an extra token — still useful for matching.
	const withoutTld =
		labels.length >= 2 ? labels.slice(0, -1).join(" ") : labels[0] ?? "";

	return withoutTld
		.replace(/[-_]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Second-level host label (`hitachirail-cd.com` → `hitachirail-cd`).
 * Ignores a leading `www.` already stripped by `normalizeDomain`.
 */
export function secondLevelLabel(host: string | null | undefined): string | null {
	const bare = normalizeDomain(host) ?? host?.trim().toLowerCase() ?? "";
	if (!bare) return null;
	const labels = bare.split(".");
	if (labels.length < 2) return null;
	return labels[0] ?? null;
}

/**
 * True when two hosts look like the same organisation family.
 *
 * Rules: same second-level label, one label contains the other (shorter ≥ 6),
 * or they share a character prefix of length ≥ 6.
 */
export function hostsRelated(
	a: string | null | undefined,
	b: string | null | undefined,
): boolean {
	const la = secondLevelLabel(a);
	const lb = secondLevelLabel(b);
	if (!la || !lb) return false;
	if (la === lb) return true;

	const shorter = la.length <= lb.length ? la : lb;
	const longer = la.length > lb.length ? la : lb;
	if (shorter.length >= 6 && longer.includes(shorter)) return true;

	let i = 0;
	const limit = Math.min(la.length, lb.length);
	while (i < limit && la[i] === lb[i]) i += 1;
	return i >= 6;
}
