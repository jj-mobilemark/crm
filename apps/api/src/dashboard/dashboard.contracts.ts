import { z } from "zod";

/**
 * Whose numbers the overview shows.
 *
 * `"me"` is the default because the page answers "how am I doing" first — a rep
 * opening the app wants their own quarter, not the team's. `"everyone"` is the
 * same page over every owner, which is what a founder or a manager wants.
 */
const DASHBOARD_SCOPES = ["me", "everyone"] as const;

/**
 * Closed-won / win-rate window on the overview.
 *
 * Open pipeline and the forecast tables ignore this — they stay "all open".
 * `"this_year"` (since 1 Jan) is the default so a Sage-heavy book of closed
 * deals lands on the page without a narrow calendar-month cut.
 */
export const DASHBOARD_RANGES = [
	"today",
	"this_week",
	"this_month",
	"this_year",
	"past_30",
	"custom",
] as const;

export const dashboardSummaryInput = z.object({
	scope: z.enum(DASHBOARD_SCOPES).default("me"),
	range: z.enum(DASHBOARD_RANGES).default("this_year"),
	/** `YYYY-MM-DD` — only read when `range` is `custom`. */
	from: z.string().date().optional(),
	/** `YYYY-MM-DD` — only read when `range` is `custom`. */
	to: z.string().date().optional(),
});

export type DashboardSummaryInput = z.infer<typeof dashboardSummaryInput>;

/**
 * Manager view of one rep — same date range as the overview, fixed to that
 * owner's deals.
 */
export const dashboardRepSummaryInput = z.object({
	userId: z.string().min(1),
	range: z.enum(DASHBOARD_RANGES).default("this_year"),
	from: z.string().date().optional(),
	to: z.string().date().optional(),
});

export type DashboardRepSummaryInput = z.infer<typeof dashboardRepSummaryInput>;
