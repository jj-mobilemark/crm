import { db, writeTripItinerary, type TripItinerary } from "@crm/db";
import { defineTool } from "eve/tools";
import { z } from "zod";

const stopSchema = z.object({
	companyId: z.string(),
	companyName: z.string(),
	city: z.string().nullable().optional(),
	stateCode: z.string().nullable().optional(),
	streetAddress: z.string().nullable().optional(),
	sage100CustomerNo: z.string().nullable().optional(),
	contactCount: z.number().int().min(0).optional(),
	milesFromHub: z.number().nullable().optional(),
	notes: z.string().nullable().optional(),
});

const daySchema = z.object({
	day: z.number().int().min(1),
	label: z.string().nullable().optional(),
	stops: z.array(stopSchema).min(1),
});

/**
 * Persist a structured day-by-day itinerary on the TripPlan so the UI can
 * download a PDF. Mechanical write only — the agent chooses the sequence.
 */
export default defineTool({
	description:
		"Save a structured day-by-day itinerary on the trip plan (days and stops with company ids/names). Marks the plan PLANNED so the rep can download a PDF. Call when the visit plan is ready; overwrite is fine.",
	inputSchema: z.object({
		tripPlanId: z
			.string()
			.describe("The trip plan id from the session preamble."),
		summary: z
			.string()
			.nullable()
			.optional()
			.describe("One-line overview of the trip plan."),
		days: z.array(daySchema).min(1),
	}),
	async execute(input) {
		const itinerary: TripItinerary = {
			summary: input.summary ?? null,
			days: input.days.map((day) => ({
				day: day.day,
				label: day.label ?? null,
				stops: day.stops.map((stop) => ({
					companyId: stop.companyId,
					companyName: stop.companyName,
					city: stop.city ?? null,
					stateCode: stop.stateCode ?? null,
					streetAddress: stop.streetAddress ?? null,
					sage100CustomerNo: stop.sage100CustomerNo ?? null,
					contactCount: stop.contactCount ?? 0,
					milesFromHub: stop.milesFromHub ?? null,
					notes: stop.notes ?? null,
				})),
			})),
		};

		try {
			const plan = await writeTripItinerary(db, input.tripPlanId, itinerary);
			if (!plan) {
				return {
					ok: false as const,
					reason: `No trip plan with id ${input.tripPlanId}.`,
				};
			}
			return {
				ok: true as const,
				tripPlanId: plan.id,
				status: plan.status,
				dayCount: itinerary.days.length,
				stopCount: itinerary.days.reduce((n, d) => n + d.stops.length, 0),
				note: "Itinerary saved. The rep can download a PDF from Trip Planner.",
			};
		} catch (error) {
			return {
				ok: false as const,
				reason: error instanceof Error ? error.message : String(error),
			};
		}
	},
});
