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
 * open stages: it is a disqualification, so showing it mid-funnel would suggest
 * a deal is progressing when it is over.
 */
const ORDER = [
	DealStage.DEMO_BOOKED,
	DealStage.QUALIFIED_TO_BUY,
	DealStage.DECISION_MAKER_BOUGHT_IN,
	DealStage.CONTRACT_SENT,
	DealStage.IN_PURCHASING,
	DealStage.CLOSED_WON,
	DealStage.CLOSED_LOST,
	DealStage.UNQUALIFIED_TO_BUY,
] as const;

// Labels only — enum keys stay HubSpot-style; Sage maps into them (§3.3).
// Mobile Mark process: Leads → Investigation → Quote → Negotiation → In Purchasing.
const PRESENTATION: Record<DealStage, { label: string; tone: StatusTone }> = {
	DEMO_BOOKED: { label: "Leads", tone: "neutral" },
	QUALIFIED_TO_BUY: { label: "Investigation", tone: "info" },
	DECISION_MAKER_BOUGHT_IN: { label: "Quote", tone: "info" },
	CONTRACT_SENT: { label: "Negotiation", tone: "warning" },
	IN_PURCHASING: { label: "In Purchasing", tone: "warning" },
	CLOSED_WON: { label: "Closed won", tone: "success" },
	CLOSED_LOST: { label: "Closed lost", tone: "error" },
	UNQUALIFIED_TO_BUY: { label: "Unqualified", tone: "neutral" },
};

/** Stages a deal can still be won from — the pipeline. */
export const OPEN_STAGES = ORDER.slice(0, 5) as readonly DealStage[];

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
	"var(--chart-5)",
] as const;

export function dealStageColor(stage: DealStage): string {
	return OPEN_STAGE_COLORS[OPEN_STAGES.indexOf(stage)] ?? "var(--chart-1)";
}

export function dealStageLabel(stage: DealStage): string {
	return PRESENTATION[stage].label;
}

/** Certainty % shown beside the stage name on the printed forecast. */
export function dealStageCertainty(stage: DealStage): number {
	switch (stage) {
		case DealStage.DEMO_BOOKED:
			return 10;
		case DealStage.QUALIFIED_TO_BUY:
			return 25;
		case DealStage.DECISION_MAKER_BOUGHT_IN:
			return 50;
		case DealStage.CONTRACT_SENT:
			return 75;
		case DealStage.IN_PURCHASING:
			return 90;
		case DealStage.CLOSED_WON:
			return 100;
		default:
			return 0;
	}
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
