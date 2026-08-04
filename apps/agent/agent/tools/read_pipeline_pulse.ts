import { db, loadPipelinePulse, type PipelinePulseScope } from "@crm/db";
import { defineTool } from "eve/tools";
import { z } from "zod";

/**
 * Mechanical pipeline pulse — same query as overview `dashboard.summary.pulse`.
 *
 * Free (our DB). Call first on a pipeline session. Never invent numbers: only
 * report what this returns. Drill into a deal with `read_deal_history`.
 */
export default defineTool({
	description:
		"Read the pipeline pulse for Me or Everyone: change counts (default last 7 days), biggest movers, recent feed, and deals stuck 14+ days without a stage/certainty move. The overview strip uses the same helper but passes the selected date range for change counts; stuck stays 14d+. Call this first on a pipeline session; never invent totals.",
	inputSchema: z.object({
		scope: z
			.enum(["me", "everyone"])
			.describe("Me = the acting rep's owned deals; Everyone = all deals."),
		userId: z
			.string()
			.optional()
			.describe(
				"Required when scope is me — the signed-in rep's user id (from the session).",
			),
	}),
	async execute({ scope, userId }) {
		const pulseScope = scope as PipelinePulseScope;
		if (pulseScope === "me" && !userId) {
			return {
				found: false as const,
				reason:
					"scope=me needs userId (the signed-in rep). Use the acting user id from the session.",
			};
		}

		const pulse = await loadPipelinePulse(db, {
			scope: pulseScope,
			userId: userId ?? null,
		});

		return {
			found: true as const,
			...pulse,
			note:
				pulse.counts.total === 0 && pulse.stuck.length === 0
					? "No tracked changes in the window yet (the log is forward-only) and no stuck deals matched. Say so plainly — do not invent activity."
					: "Cite deal ids from movers/recent/stuck. Use read_deal_history to drill down. Never invent totals.",
		};
	},
});
