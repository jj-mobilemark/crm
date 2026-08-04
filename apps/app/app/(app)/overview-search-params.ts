import {
	createLoader,
	parseAsString,
	parseAsStringLiteral,
} from "nuqs/server";

/**
 * The overview URL. Shared by the page's server-side prefetch and the client
 * panel, so the two cannot ask for different things — the same reason the list
 * modules keep their parsers in one file.
 *
 * Imported from `nuqs/server`: parsers are plain data, and this module is pulled
 * into both a server component and a client one.
 */

/** Kept in step with `DASHBOARD_SCOPES` in the API's dashboard contracts. */
export const OVERVIEW_SCOPES = ["me", "everyone"] as const;

export type OverviewScope = (typeof OVERVIEW_SCOPES)[number];

/**
 * Kept in step with `DASHBOARD_RANGES` in the API's dashboard contracts.
 *
 * Closed-won / win-rate only — open pipeline and forecast ignore this.
 */
export const OVERVIEW_RANGES = [
	"today",
	"this_week",
	"this_month",
	"this_year",
	"past_30",
	"custom",
] as const;

export type OverviewRange = (typeof OVERVIEW_RANGES)[number];

/**
 * Close window for the Everyone certainty × rep grid.
 * Kept in step with `CERTAINTY_BY_REP_WINDOWS` in the API contracts.
 */
export const CERTAINTY_BY_REP_WINDOWS = [
	"this_month",
	"next_30",
	"next_3m",
	"next_6m",
	"custom",
] as const;

export type CertaintyByRepWindow = (typeof CERTAINTY_BY_REP_WINDOWS)[number];

export const overviewParsers = {
	// A literal parser, not a plain string: `?scope=nonsense` then falls back to
	// the default rather than reaching the API as an unhandled value.
	scope: parseAsStringLiteral(OVERVIEW_SCOPES).withDefault("me"),
	range: parseAsStringLiteral(OVERVIEW_RANGES).withDefault("this_year"),
	/** `YYYY-MM-DD` — only sent when `range=custom`. */
	from: parseAsString,
	/** `YYYY-MM-DD` — only sent when `range=custom`. */
	to: parseAsString,
	/** Certainty × rep grid window — Everyone only; independent of `range`. */
	certWindow: parseAsStringLiteral(CERTAINTY_BY_REP_WINDOWS).withDefault(
		"this_month",
	),
	certFrom: parseAsString,
	certTo: parseAsString,
};

export const loadOverviewSearchParams = createLoader(overviewParsers);
