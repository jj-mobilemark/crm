/**
 * Client mirror of `companyNameGuessFromDomain` in the API — keep in sync.
 * `hitachirail-cd.com` → `hitachirail cd`.
 */
export function companyNameGuessFromDomain(domain: string): string {
	const host = domain.trim().toLowerCase().replace(/^www\./, "");
	if (!host) return "";
	const labels = host.split(".");
	const withoutTld =
		labels.length >= 2 ? labels.slice(0, -1).join(" ") : (labels[0] ?? "");
	return withoutTld
		.replace(/[-_]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}
