import { db, loadTripPlan } from "@crm/db";
import { defineTool } from "eve/tools";
import { z } from "zod";

/**
 * Mechanical trip brief — same row the Trip Planner UI edits.
 *
 * Free (our DB). Call first on a trip session. Never invent hub or criteria.
 */
export default defineTool({
	description:
		"Read a saved Trip Planner brief: hub city/state, days, radius, activity mode (ACTIVE/SALVAGE), years, must-visit company ids, notes, and any saved itinerary. Call this first on a trip session; never invent the brief.",
	inputSchema: z.object({
		tripPlanId: z.string().describe("The trip plan id from the session preamble."),
	}),
	async execute({ tripPlanId }) {
		const plan = await loadTripPlan(db, tripPlanId);
		if (!plan) {
			return {
				found: false as const,
				reason: `No trip plan with id ${tripPlanId}.`,
			};
		}
		return { found: true as const, ...plan };
	},
});
