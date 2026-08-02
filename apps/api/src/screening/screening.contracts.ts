import { z } from "zod";

export const screeningDecideInput = z.object({
	id: z.string().min(1),
	decision: z.enum(["approve", "reject"]),
	/** Optional overrides when approving — defaults come from the harvested row. */
	createContact: z
		.object({
			firstName: z.string().trim().min(1).optional(),
			lastName: z.string().trim().optional(),
			companyId: z.string().nullable().optional(),
		})
		.optional(),
	/** On reject: also insert the domain into SuppressedDomain. */
	suppressDomain: z.boolean().optional(),
});

export type ScreeningDecideInput = z.infer<typeof screeningDecideInput>;
