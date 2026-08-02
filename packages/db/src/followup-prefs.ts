/**
 * Per-rep Follow-ups priority prefs — shared by the API (list filters) and the
 * agent (daily sweep window + preamble bias). Keep the string unions here so
 * both sides cannot drift.
 */

export const FOLLOWUP_FLOAT_FIRST = [
	"balanced",
	"commitments",
	"replies",
	"deal-risk",
] as const;

export const FOLLOWUP_LOOKBACK = ["7d", "30d", "90d"] as const;

export const FOLLOWUP_SCOPE = ["owned", "shared", "mail"] as const;

export type FollowupFloatFirst = (typeof FOLLOWUP_FLOAT_FIRST)[number];
export type FollowupLookback = (typeof FOLLOWUP_LOOKBACK)[number];
export type FollowupScope = (typeof FOLLOWUP_SCOPE)[number];

export type FollowupPrefs = {
	floatFirst: FollowupFloatFirst;
	lookback: FollowupLookback;
	scope: FollowupScope;
};

export const DEFAULT_FOLLOWUP_PREFS: FollowupPrefs = {
	floatFirst: "balanced",
	lookback: "30d",
	scope: "owned",
};

export function lookbackDays(lookback: FollowupLookback): number {
	switch (lookback) {
		case "7d":
			return 7;
		case "90d":
			return 90;
		default:
			return 30;
	}
}

/** Kind boost for list reorder — lower sorts first. Unknown kinds land last. */
export function floatFirstKindRank(
	floatFirst: FollowupFloatFirst,
	kind: string,
): number {
	if (floatFirst === "balanced") return 50;

	const order: Record<Exclude<FollowupFloatFirst, "balanced">, string[]> = {
		commitments: ["commitment", "next-step", "reply-owed", "deal-risk"],
		replies: ["reply-owed", "commitment", "next-step", "deal-risk"],
		"deal-risk": ["deal-risk", "next-step", "commitment", "reply-owed"],
	};

	const rank = order[floatFirst].indexOf(kind);
	return rank === -1 ? 50 : rank;
}

/** Mail-driven scope drops deal-risk suggestions from the panel. */
export function kindAllowedForScope(
	scope: FollowupScope,
	kind: string,
): boolean {
	if (scope !== "mail") return true;
	return kind !== "deal-risk";
}
