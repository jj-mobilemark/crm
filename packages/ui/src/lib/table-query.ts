export type SortDirection = "asc" | "desc";

/**
 * The contract between a list page's URL state and `DataTable`.
 *
 * The table renders the controls and reads the current values; it never owns
 * them. The implementation lives in the app (`useTableQuery`) because routing
 * is not the design system's business — but the shape belongs next to the
 * component that consumes it, so the two cannot drift.
 *
 * Search is not in here. It is the one list control that lives in the page
 * header rather than the toolbar, so it reads `q` out of the URL itself and the
 * table never sees it.
 */
export type TableQueryState = {
	sort: string;
	dir: SortDirection;
	page: number;
	pageSize: number;
	/** `"all"` when no tab is selected. */
	tab: string;
	tabId?: string;
	/** Facet id → selected value, `"all"` when unfiltered. */
	filters: Record<string, string>;
	toggleSort: (id: string) => void;
	setSort: (id: string) => void;
	setDir: (dir: SortDirection) => void;
	setPage: (page: number) => void;
	setTab: (value: string) => void;
	setFilter: (id: string, value: string) => void;
};
