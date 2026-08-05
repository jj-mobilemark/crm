import { db, loadTripPlan, searchTripCandidates } from "@crm/db";
import { defineTool } from "eve/tools";
import { z } from "zod";

/**
 * Mechanical nearby-company ranking for Trip Planner.
 *
 * Same helper as Nest `tripPlans.candidates`. Cap ~60. Never invent companies.
 */
export default defineTool({
	description:
		"Search companies near a trip hub within the plan's radius and activity mode (ACTIVE = deal created/closed in the last N years OR any still-open deal; SALVAGE = no deal in that window). Returns a ranked shortlist: must-visits first, then the planner's own accounts (ownership=mine), then unassigned, then other-owned. Within each band: open deals by deal size (openPipelineAmount), then other activity, then distance. Cap ~60. Never invent companies or totals.",
	inputSchema: z.object({
		tripPlanId: z.string().describe("The trip plan id from the session preamble."),
		limit: z
			.number()
			.int()
			.min(1)
			.max(100)
			.optional()
			.describe("Optional cap (default 60)."),
	}),
	async execute({ tripPlanId, limit }) {
		const plan = await loadTripPlan(db, tripPlanId);
		if (!plan) {
			return {
				found: false as const,
				reason: `No trip plan with id ${tripPlanId}.`,
			};
		}

		const candidates = await searchTripCandidates(db, {
			hubLatitude: plan.hubLatitude,
			hubLongitude: plan.hubLongitude,
			radiusMiles: plan.radiusMiles,
			activityMode: plan.activityMode,
			activityYears: plan.activityYears,
			mustVisitCompanyIds: plan.mustVisitCompanyIds,
			plannerUserId: plan.userId,
			limit,
		});

		const otherOwned = candidates.filter((c) => c.ownership === "other");

		return {
			found: true as const,
			tripPlanId,
			hub: `${plan.hubCity}, ${plan.hubStateCode}`,
			radiusMiles: plan.radiusMiles,
			activityMode: plan.activityMode,
			activityYears: plan.activityYears,
			count: candidates.length,
			candidates,
			note:
				candidates.length === 0
					? "No companies matched the radius and activity filter. Say so plainly — do not invent stops."
					: [
							"Rank order is intentional: must-visits, then ownership (mine → unassigned → other), then open-deal size, then the rest.",
							"Default the itinerary to ownership=mine (plus must-visits). Unassigned may fill leftover slots without asking.",
							otherOwned.length > 0
								? `There are ${otherOwned.length} other-owned account(s) on this shortlist. If any look like strong visit candidates (high openPipelineAmount or strong salvage signal), call them out by name and ownerName and ask the rep with ask_question before adding them — do not schedule another rep's account silently.`
								: "No other-owned accounts on this shortlist.",
							"Use company ids from this list when building the itinerary. Call write_trip_itinerary when ready.",
						].join(" "),
		};
	},
});
