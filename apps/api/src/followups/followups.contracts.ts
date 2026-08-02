import { z } from "zod";

/** Matches `FollowUpSuggestion.kind` — see the Prisma schema doc comment. */
export const followUpKinds = [
	"commitment",
	"reply-owed",
	"deal-risk",
	"next-step",
] as const;

export const followupDecideInput = z.object({
	id: z.string().min(1),
	decision: z.enum(["accept", "dismiss", "snooze"]),
	/** ISO-8601. Required for `snooze`; optional override for `accept`. */
	dueAt: z.string().optional(),
});

export type FollowupDecideInput = z.infer<typeof followupDecideInput>;
