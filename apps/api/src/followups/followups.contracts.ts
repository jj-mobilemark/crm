import {
	FOLLOWUP_FLOAT_FIRST,
	FOLLOWUP_LOOKBACK,
	FOLLOWUP_SCOPE,
} from "@crm/db";
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

export const followupPrefsInput = z.object({
	floatFirst: z.enum(FOLLOWUP_FLOAT_FIRST),
	lookback: z.enum(FOLLOWUP_LOOKBACK),
	scope: z.enum(FOLLOWUP_SCOPE),
});

export type FollowupPrefsInput = z.infer<typeof followupPrefsInput>;
