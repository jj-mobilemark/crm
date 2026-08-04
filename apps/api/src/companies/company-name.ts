/**
 * Collapse a company name for soft matching: case, punctuation, and common
 * legal suffixes do not count as a different company.
 *
 * "Acme, Inc." and "ACME LLC" both become "acme". Used only for duplicate
 * suggestions on create — never as a unique key (domain still owns that).
 */
export function normalizeCompanyName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[&+'"]/g, " ")
		.replace(/[^a-z0-9\s]/g, " ")
		.replace(
			/\b(incorporated|corporation|company|limited|llc|ltd|inc|corp|plc|gmbh|co)\b/g,
			" ",
		)
		.replace(/\s+/g, " ")
		.trim();
}
