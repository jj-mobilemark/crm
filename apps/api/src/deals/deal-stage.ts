import { DealStage } from "@crm/db";

/**
 * Stages a deal can still be won from. Pipeline value and the forecast are the
 * sum over these.
 *
 * Order matches the Mobile Mark sales process: Leads → Investigation → Quote →
 * Negotiation → In Purchasing.
 */
export const OPEN_DEAL_STAGES = [
	DealStage.DEMO_BOOKED,
	DealStage.QUALIFIED_TO_BUY,
	DealStage.DECISION_MAKER_BOUGHT_IN,
	DealStage.CONTRACT_SENT,
	DealStage.IN_PURCHASING,
] as const;

/**
 * Stages a deal is finished in. `UNQUALIFIED_TO_BUY` belongs here rather than
 * mid-funnel: it is a disqualification, not a step forward, and counting it as
 * open would inflate the pipeline with deals nobody is working.
 */
export const CLOSED_DEAL_STAGES = [
	DealStage.CLOSED_WON,
	DealStage.CLOSED_LOST,
	DealStage.UNQUALIFIED_TO_BUY,
] as const;

/** Closed stages that need a reason typed in. */
export const LOSING_DEAL_STAGES = [
	DealStage.CLOSED_LOST,
	DealStage.UNQUALIFIED_TO_BUY,
] as const;

const CLOSED = new Set<DealStage>(CLOSED_DEAL_STAGES);

export function isClosedStage(stage: DealStage): boolean {
	return CLOSED.has(stage);
}

/**
 * Default certainty % when a deal moves to this stage.
 *
 * Matches the team's printed forecast bands: 10 / 25 / 50 / 75 / 90 / 100.
 */
export const STAGE_CERTAINTY: Record<DealStage, number> = {
	[DealStage.DEMO_BOOKED]: 10,
	[DealStage.QUALIFIED_TO_BUY]: 25,
	[DealStage.DECISION_MAKER_BOUGHT_IN]: 50,
	[DealStage.CONTRACT_SENT]: 75,
	[DealStage.IN_PURCHASING]: 90,
	[DealStage.CLOSED_WON]: 100,
	[DealStage.CLOSED_LOST]: 0,
	[DealStage.UNQUALIFIED_TO_BUY]: 0,
};

export function certaintyForStage(stage: DealStage): number {
	return STAGE_CERTAINTY[stage];
}

/**
 * Weighted revenue from unweighted amount × certainty %.
 *
 * Returns null when either side is missing — same as Sage when forecast is
 * blank.
 */
export function weightedFromAmount(
	amount: number | null,
	probability: number | null,
): number | null {
	if (amount === null || probability === null) return null;
	return (amount * probability) / 100;
}
