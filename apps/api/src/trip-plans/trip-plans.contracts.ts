import { z } from "zod";

export const tripActivityMode = z.enum(["ACTIVE", "SALVAGE"]);
export const tripPlanStatus = z.enum(["DRAFT", "PLANNED"]);

export const tripPlanIdInput = z.object({ id: z.string() });

export const tripPlanCreateInput = z.object({
	hubCity: z.string().trim().min(1, "A hub city is required."),
	hubStateCode: z
		.string()
		.trim()
		.min(2, "A state code is required.")
		.max(2)
		.transform((s) => s.toUpperCase()),
	dayCount: z.number().int().min(1).max(30).default(3),
	radiusMiles: z.number().int().min(25).max(500).default(200),
	activityMode: tripActivityMode.default("ACTIVE"),
	activityYears: z.number().int().min(1).max(20).default(3),
	mustVisitCompanyIds: z.array(z.string()).default([]),
	maxVisitsPerDay: z.number().int().min(1).max(20).nullable().optional(),
	notes: z.string().trim().max(2000).nullable().optional(),
});

export type TripPlanCreateInput = z.infer<typeof tripPlanCreateInput>;

export const tripPlanUpdateInput = z.object({
	id: z.string(),
	hubCity: z.string().trim().min(1).optional(),
	hubStateCode: z
		.string()
		.trim()
		.min(2)
		.max(2)
		.transform((s) => s.toUpperCase())
		.optional(),
	dayCount: z.number().int().min(1).max(30).optional(),
	radiusMiles: z.number().int().min(25).max(500).optional(),
	activityMode: tripActivityMode.optional(),
	activityYears: z.number().int().min(1).max(20).optional(),
	mustVisitCompanyIds: z.array(z.string()).optional(),
	maxVisitsPerDay: z.number().int().min(1).max(20).nullable().optional(),
	notes: z.string().trim().max(2000).nullable().optional(),
});

export type TripPlanUpdateInput = z.infer<typeof tripPlanUpdateInput>;

export const tripPlanCandidatesInput = z.object({
	id: z.string(),
	limit: z.number().int().min(1).max(100).optional(),
});
