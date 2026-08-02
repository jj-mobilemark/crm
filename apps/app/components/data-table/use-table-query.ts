"use client";

import type { TableQueryState } from "@crm/ui/lib/table-query";
import { useQueryStates } from "nuqs";
import type {
	ListInput,
	ListSearchParams,
	ListSearchValues,
} from "./list-search-params";

export type TableQuery<TKey extends string> = {
	/** Passed to `<DataTable query={…}>`. */
	query: TableQueryState;
	/** Passed to the module's `list` procedure. */
	input: ListInput<TKey>;
};

/**
 * Binds a module's URL parsers to the `DataTable` contract.
 *
 * Lives in the app rather than in `@crm/ui` because it is routing state: the
 * design system renders the controls, the app decides what a URL means.
 *
 * Nothing here is debounced or deferred. `q` reaches the URL only once typing
 * has paused, because `ListSearch` holds the keystrokes in local state until
 * then — so by the time this reads it, every value in the URL is one a user
 * settled on and is worth a request.
 */
export function useTableQuery<TTab extends string, TFacet extends string>(
	searchParams: ListSearchParams<TTab, TFacet>,
): TableQuery<TTab | TFacet> {
	const { parsers, config, toInput } = searchParams;
	const { defaultDir, pageSize, tabId, facetIds, facetDefaults } = config;

	const [state, setState] = useQueryStates(parsers);
	const values = state as ListSearchValues<TTab | TFacet>;

	const page = values.page > 0 ? values.page : 1;
	const tab = tabId ? values[tabId] : "all";

	const filters: Record<string, string> = {};
	if (tabId) filters[tabId] = tab;
	for (const id of facetIds ?? []) {
		filters[id] = values[id] ?? facetDefaults?.[id] ?? "all";
	}

	const query: TableQueryState = {
		sort: values.sort,
		dir: values.dir,
		page,
		pageSize,
		tab,
		tabId,
		filters,
		// Every filter change resets to page 1: staying on page 7 of a result set
		// that now has two pages shows an empty table.
		toggleSort: (id) =>
			setState((prev) =>
				prev.sort === id
					? { ...prev, dir: prev.dir === "asc" ? "desc" : "asc", page: 1 }
					: { ...prev, sort: id, dir: defaultDir, page: 1 },
			),
		setSort: (id) => setState((prev) => ({ ...prev, sort: id, page: 1 })),
		setDir: (dir) => setState((prev) => ({ ...prev, dir, page: 1 })),
		setPage: (next) => setState((prev) => ({ ...prev, page: next })),
		setTab: (value) => {
			if (!tabId) return;
			setState((prev) => ({ ...prev, [tabId]: value, page: 1 }));
		},
		setFilter: (id, value) =>
			setState((prev) => ({ ...prev, [id]: value, page: 1 })),
	};

	return { query, input: toInput(values) };
}
