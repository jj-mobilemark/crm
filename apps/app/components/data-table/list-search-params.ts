import type { SortDirection } from "@crm/ui/lib/table-query";
import {
	createLoader,
	type LoaderFunction,
	type ParserBuilder,
	parseAsInteger,
	parseAsString,
	parseAsStringLiteral,
} from "nuqs/server";

/**
 * One parser map per list module, shared by the page (which parses
 * `searchParams` to prefetch on the server) and the client panel (which reads
 * the same keys through `useTableQuery`). Defining them twice is how a page
 * ends up prefetching a different query than the one the browser then asks
 * for — so they are defined once, here.
 *
 * Imported from `nuqs/server` deliberately: parsers are plain data, and this
 * module is pulled into both a server component and a client one.
 */

const SORT_DIRECTIONS = ["asc", "desc"] as const;

type StringParser = ParserBuilder<string> & { defaultValue: string };

/**
 * The two keys the search box owns, identical on every list.
 *
 * Exported so `ListSearch` can bind to them without being handed a module's
 * whole parser map. Search genuinely does not care which list it is on, and
 * taking the map would cost more than it looks: parsers carry functions, a
 * server component cannot pass a function to a client one, so every page would
 * need a client wrapper of its own whose only job is to import the map on the
 * right side of the boundary.
 */
export const searchParsers = {
	q: parseAsString.withDefault(""),
	// Paging is the one table change worth a Back button.
	page: parseAsInteger.withDefault(1).withOptions({ history: "push" }),
};

/**
 * Base keys every list has, plus one string key per tab and facet.
 *
 * `TKey` is a union of literal key names rather than `string`: an index
 * signature here would collide with `page: number` and make every setter
 * untypeable.
 */
type ListParsers<TKey extends string> = {
	q: StringParser;
	sort: StringParser;
	dir: ParserBuilder<SortDirection> & { defaultValue: SortDirection };
	page: ParserBuilder<number> & { defaultValue: number };
} & { [K in TKey]: StringParser };

export type ListSearchValues<TKey extends string> = {
	q: string;
	sort: string;
	dir: SortDirection;
	page: number;
} & { [K in TKey]: string };

/** What a list procedure receives: the shared `listInput` plus tab and facets. */
export type ListInput<TKey extends string> = {
	q: string;
	sort: string;
	dir: SortDirection;
	page: number;
	pageSize: number;
} & { [K in TKey]: string };

export type ListTableConfig<TTab extends string, TFacet extends string> = {
	/** Column id sorted by default; `""` means the API's own ordering. */
	defaultSort?: string;
	defaultDir?: SortDirection;
	pageSize?: number;
	/** Query key for the tab selector, e.g. `"stage"`. */
	tabId?: TTab;
	/** Query keys for the facet dropdowns, e.g. `["owner", "industry"]`. */
	facetIds?: readonly TFacet[];
	/** Facet id → value to start on, when it should not be `"all"`. */
	facetDefaults?: Partial<Record<TFacet, string>>;
};

export type ListSearchParams<TTab extends string, TFacet extends string> = {
	config: ListTableConfig<TTab, TFacet> & {
		defaultSort: string;
		defaultDir: SortDirection;
		pageSize: number;
	};
	parsers: ListParsers<TTab | TFacet>;
	/** Server-side: `await load(searchParams)` in the page. */
	load: LoaderFunction<ListParsers<TTab | TFacet>>;
	/** Parsed URL values → the object the module's `list` procedure takes. */
	toInput: (
		values: ListSearchValues<TTab | TFacet>,
	) => ListInput<TTab | TFacet>;
};

export function createListSearchParams<
	TTab extends string = never,
	TFacet extends string = never,
>(config: ListTableConfig<TTab, TFacet> = {}): ListSearchParams<TTab, TFacet> {
	const {
		defaultSort = "",
		defaultDir = "asc",
		pageSize = 25,
		tabId,
		facetIds = [],
		facetDefaults,
	} = config;

	const extras: Record<string, StringParser> = {};

	if (tabId) extras[tabId] = parseAsString.withDefault("all");
	for (const id of facetIds) {
		extras[id] = parseAsString.withDefault(facetDefaults?.[id] ?? "all");
	}

	const parsers = {
		...searchParsers,
		sort: parseAsString.withDefault(defaultSort),
		dir: parseAsStringLiteral(SORT_DIRECTIONS).withDefault(defaultDir),
		...extras,
	} as ListParsers<TTab | TFacet>;

	const keys = [...(tabId ? [tabId] : []), ...facetIds] as (TTab | TFacet)[];

	return {
		config: { ...config, defaultSort, defaultDir, pageSize },
		parsers,
		load: createLoader(parsers),
		toInput: (values) => {
			// `"all"` is passed through rather than stripped: every list procedure
			// defaults its tab and facets to "all", so the two sides agree without
			// either needing to know which keys are optional.
			const selected: Record<string, string> = {};
			for (const key of keys) {
				selected[key] = values[key] ?? "all";
			}

			return {
				q: values.q.trim(),
				sort: values.sort,
				dir: values.dir,
				page: values.page > 0 ? values.page : 1,
				pageSize,
				...selected,
			} as ListInput<TTab | TFacet>;
		},
	};
}
