import {
	db,
	loadPipelineReport,
	type PipelineReportMode,
	type PipelineReportScope,
} from "@crm/db";
import { defineTool } from "eve/tools";
import { z } from "zod";

/**
 * Mechanical pipeline reports beyond the 7-day pulse — open by stage, forecast
 * by close month, closing / closed in a calendar month.
 *
 * Free (our DB). Prefer unweighted amount (deal value); weighted is secondary.
 * Never invent numbers: only report what this returns.
 */
export default defineTool({
	description:
		"Read a pipeline report for Me or Everyone: open totals by stage, forecast by expected-close month, open deals closing in a month, or deals closed in a month. Use for month / closing / closed / by-stage questions — not the 7-day change log (that is read_pipeline_pulse). Never invent totals.",
	inputSchema: z.object({
		scope: z
			.enum(["me", "everyone"])
			.describe("Me = the acting rep's owned deals; Everyone = all deals."),
		mode: z
			.enum([
				"open_by_stage",
				"forecast_by_close_month",
				"closing_in_month",
				"closed_in_month",
			])
			.describe(
				"open_by_stage = open pipeline by CRM stage; forecast_by_close_month = open deals by expectedCloseDate month (optional month filter); closing_in_month = open deals with close date in month; closed_in_month = won/lost/unqualified with closedAt in month.",
			),
		month: z
			.string()
			.regex(/^\d{4}-\d{2}$/)
			.optional()
			.describe(
				"Calendar month YYYY-MM. Required for closing_in_month and closed_in_month; optional filter for forecast_by_close_month.",
			),
		userId: z
			.string()
			.optional()
			.describe(
				"Required when scope is me — the signed-in rep's user id (from the session).",
			),
		includeDeals: z
			.boolean()
			.optional()
			.describe(
				"When true (default), include up to 40 deal rows. Aggregates stay full-accuracy either way.",
			),
	}),
	async execute({ scope, mode, month, userId, includeDeals }) {
		const reportScope = scope as PipelineReportScope;
		const reportMode = mode as PipelineReportMode;

		if (reportScope === "me" && !userId) {
			return {
				found: false as const,
				reason:
					"scope=me needs userId (the signed-in rep). Use the acting user id from the session.",
			};
		}

		if (
			(reportMode === "closing_in_month" || reportMode === "closed_in_month") &&
			!month
		) {
			return {
				found: false as const,
				reason: `mode=${reportMode} needs month as YYYY-MM (e.g. 2026-08).`,
			};
		}

		try {
			const report = await loadPipelineReport(db, {
				scope: reportScope,
				mode: reportMode,
				month: month ?? null,
				userId: userId ?? null,
				includeDeals: includeDeals !== false,
			});

			return {
				found: true as const,
				...report,
				note:
					report.totals.dealCount === 0
						? "No deals matched. Say so plainly — do not invent totals."
						: report.truncated
							? "Deal list is capped at 40; totals and buckets are full-accuracy. Cite deal ids from the list. Prefer unweighted amountCents; weightedAmountCents is secondary."
							: "Cite deal ids from the list. Prefer unweighted amountCents (deal value); weightedAmountCents is secondary. Never invent totals.",
			};
		} catch (error) {
			return {
				found: false as const,
				reason: error instanceof Error ? error.message : "Report query failed.",
			};
		}
	},
});
