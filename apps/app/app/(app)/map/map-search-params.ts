import {
	createLoader,
	parseAsInteger,
	parseAsString,
	parseAsStringLiteral,
	type SearchParams,
} from "nuqs/server";

const OWNERS = ["all", "me", "unassigned"] as const;
const SAGE = ["all", "linked", "unlinked"] as const;
const LOCATION = ["all", "yes", "no"] as const;
const SORTS = ["name", "city", "owner"] as const;
const DIRS = ["asc", "desc"] as const;

export const mapParsers = {
	q: parseAsString.withDefault(""),
	owner: parseAsStringLiteral(OWNERS).withDefault("all"),
	sage: parseAsStringLiteral(SAGE).withDefault("all"),
	hasLocation: parseAsStringLiteral(LOCATION).withDefault("all"),
	/** 0 = any time; 1–10 = deal opened or closed within that many years. */
	dealYears: parseAsInteger.withDefault(0),
	sort: parseAsStringLiteral(SORTS).withDefault("name"),
	dir: parseAsStringLiteral(DIRS).withDefault("asc"),
	selected: parseAsString.withDefault(""),
};

export const loadMapSearchParams = createLoader(mapParsers);

export type MapSearchValues = Awaited<ReturnType<typeof loadMapSearchParams>>;

export function mapQueryInput(values: MapSearchValues) {
	const dealYears =
		values.dealYears >= 1 && values.dealYears <= 10 ? values.dealYears : 0;
	return {
		q: values.q,
		owner: values.owner,
		sage: values.sage,
		hasLocation: values.hasLocation,
		dealYears,
		sort: values.sort,
		dir: values.dir,
	};
}

export async function parseMapSearchParams(
	searchParams: Promise<SearchParams>,
) {
	return loadMapSearchParams(searchParams);
}
