/**
 * Display line for a company address. Street + city/state/postal + country.
 * Empty parts are dropped; returns null when nothing is set.
 */
export function formatCompanyLocation(parts: {
	streetAddress?: string | null;
	city?: string | null;
	stateCode?: string | null;
	postalCode?: string | null;
	country?: string | null;
}): string | null {
	const cityLine = [parts.city, parts.stateCode, parts.postalCode]
		.filter(Boolean)
		.join(", ");
	const line = [parts.streetAddress, cityLine || null, parts.country]
		.filter(Boolean)
		.join(", ");
	return line || null;
}
