/**
 * Build a stable place key for geocode caching.
 *
 * Empty city → null (cannot place a pin). Missing state/country become "".
 */
export function buildPlaceKey(
	city: string | null | undefined,
	stateCode: string | null | undefined,
	countryCode: string | null | undefined,
): string | null {
	const c = normalizePart(city);
	if (!c) return null;
	const state = normalizePart(stateCode) ?? "";
	const country = normalizePart(countryCode) ?? "";
	return `${c}|${state}|${country}`;
}

/** Human query string for Nominatim from the same parts. */
export function buildGeocodeQuery(
	city: string | null | undefined,
	stateCode: string | null | undefined,
	country: string | null | undefined,
	countryCode: string | null | undefined,
): string | null {
	const parts = [
		normalizePart(city, false),
		normalizePart(stateCode, false),
		normalizePart(country, false) ?? normalizePart(countryCode, false),
	].filter((part): part is string => Boolean(part));
	return parts.length > 0 ? parts.join(", ") : null;
}

function normalizePart(
	value: string | null | undefined,
	lower = true,
): string | null {
	if (value == null) return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	return lower ? trimmed.toLowerCase() : trimmed;
}
