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
			/**
			 * User chose "Create from domain" after seeing matches — skip soft
			 * attach so companyForEmail creates the domain-named company.
			 */
			preferDomainCompany: z.boolean().optional(),
		})
		.optional(),
	/** On reject: also insert the domain into SuppressedDomain. */
	suppressDomain: z.boolean().optional(),
});

export type ScreeningDecideInput = z.infer<typeof screeningDecideInput>;
