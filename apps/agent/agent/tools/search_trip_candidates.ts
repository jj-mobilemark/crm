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
		"Search companies near a trip hub within the plan's radius and activity mode (ACTIVE = deal created/closed in the last N years OR any still-open deal; SALVAGE = no deal in that window). Returns a ranked shortlist: must-visits first, then accounts with open deals by deal size (openPipelineAmount), then other activity, then distance. Cap ~60. Never invent companies or totals.",
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
			limit,
		});

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
					: "Rank order is intentional: must-visits, then open-deal accounts by deal size, then the rest. Prefer filling leftover day slots with nearby open-deal companies (largest openPipelineAmount first). Use company ids from this list when building the itinerary. Call write_trip_itinerary when ready.",
		};
	},
});
