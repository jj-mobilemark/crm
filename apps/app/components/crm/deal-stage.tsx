// `@crm/db/enums` and not `@crm/db`: the package root exports the Prisma client
// instance, so a value import of an enum drags `pg` — and its `node:dns`
// dependency — into the browser bundle. The generated enums module is a
// standalone file of string constants.
import { DealStage } from "@crm/db/enums";
import {
	StatusIndicator,
	type StatusTone,
} from "@crm/ui/components/status-indicator";

/**
 * Stage presentation, in pipeline order.
 *
 * `UNQUALIFIED_TO_BUY` sits with the other closed stages rather than between
 * "qualified" and "decision maker bought in": it is a disqualification, so
 * showing it mid-funnel would suggest a deal is progressing when it is over.
 */
const ORDER = [
	DealStage.DEMO_BOOKED,
	DealStage.QUALIFIED_TO_BUY,
	DealStage.DECISION_MAKER_BOUGHT_IN,
	DealStage.CONTRACT_SENT,
	DealStage.CLOSED_WON,
	DealStage.CLOSED_LOST,
	DealStage.UNQUALIFIED_TO_BUY,
] as const;

// Labels only — enum keys stay HubSpot-style; Sage maps into them (§3.3).
// Lead ≈ blank/unknown; Negotiating ≈ Sage Negotiation; Proposal ≈ Sage Proposal.
const PRESENTATION: Record<DealStage, { label: string; tone: StatusTone }> = {
	DEMO_BOOKED: { label: "Lead", tone: "neutral" },
	QUALIFIED_TO_BUY: { label: "Qualified to buy", tone: "info" },
	DECISION_MAKER_BOUGHT_IN: { label: "Negotiating", tone: "info" },
	CONTRACT_SENT: { label: "Proposal", tone: "warning" },
	CLOSED_WON: { label: "Closed won", tone: "success" },
	CLOSED_LOST: { label: "Closed lost", tone: "error" },
	UNQUALIFIED_TO_BUY: { label: "Unqualified", tone: "neutral" },
};

/** Stages a deal can still be won from — the pipeline. */
export const OPEN_STAGES = ORDER.slice(0, 4) as readonly DealStage[];

/** Won, lost or disqualified — a deal that is no longer in the pipeline. */
export function isClosedStage(stage: DealStage): boolean {
	return !OPEN_STAGES.includes(stage);
}

/** The two the API refuses without a `closedReason`. */
export const LOSING_STAGES: readonly DealStage[] = [
	DealStage.CLOSED_LOST,
	DealStage.UNQUALIFIED_TO_BUY,
];

export const DEAL_STAGE_OPTIONS = ORDER.map((value) => ({
	value,
	label: PRESENTATION[value].label,
}));

/**
 * The chart ramp in pipeline order, so a stage is the same colour in the
 * overview's donut, its legend and every meter beside a deal.
 *
 * Only the open stages get one: a closed deal is not part of a breakdown of
 * where the pipeline sits, and `StatusTone` already colours won and lost.
 */
const OPEN_STAGE_COLORS = [
	"var(--chart-1)",
	"var(--chart-2)",
	"var(--chart-3)",
	"var(--chart-4)",
] as const;

export function dealStageColor(stage: DealStage): string {
	return OPEN_STAGE_COLORS[OPEN_STAGES.indexOf(stage)] ?? "var(--chart-5)";
}

export function dealStageLabel(stage: DealStage): string {
	return PRESENTATION[stage].label;
}

export function DealStageIndicator({
	stage,
	className,
}: {
	stage: DealStage;
	className?: string;
}) {
	const { label, tone } = PRESENTATION[stage];
	return <StatusIndicator tone={tone} label={label} className={className} />;
}
