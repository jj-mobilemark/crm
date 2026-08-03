import { DealStage, type Prisma, type PrismaClient } from "./generated/prisma/client";

/**
 * Shared pipeline pulse query — used by Nest `dashboard.summary.pulse` and the
 * agent's `read_pipeline_pulse` tool so the two cannot drift.
 *
 * Mechanical only: change-log rows + stuck open deals. No judgements.
 */

export const PULSE_WINDOW_DAYS = 7;
export const STUCK_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;
const PULSE_FEED_LIMIT = 24;
const PULSE_MOVERS_LIMIT = 10;
const PULSE_STUCK_LIMIT = 10;

const OPEN_DEAL_STAGES = [
	DealStage.DEMO_BOOKED,
	DealStage.QUALIFIED_TO_BUY,
	DealStage.DECISION_MAKER_BOUGHT_IN,
	DealStage.CONTRACT_SENT,
] as const;

const OWNER_SELECT = {
	id: true,
	name: true,
	email: true,
	image: true,
} as const;

export type PipelinePulseScope = "me" | "everyone";

export type PipelinePulse = {
	windowDays: number;
	stuckDays: number;
	since: string;
	scope: PipelinePulseScope;
	counts: {
		won: number;
		lost: number;
		certainty: number;
		stage: number;
		amount: number;
		expectedClose: number;
		owner: number;
		priority: number;
		sageStage: number;
		total: number;
	};
	movers: PulseChange[];
	recent: PulseChange[];
	stuck: PulseStuckDeal[];
};

type PulseChange = {
	id: string;
	field: string;
	fromValue: string | null;
	toValue: string | null;
	source: "app" | "sage";
	createdAt: string;
	magnitude: number | null;
	actor: {
		id: string;
		name: string;
		email: string;
		image: string | null;
	} | null;
	deal: {
		id: string;
		name: string;
		currency: string;
		company: { id: string; name: string };
		owner: {
			id: string;
			name: string;
			email: string;
			image: string | null;
		};
	};
};

type PulseStuckDeal = {
	id: string;
	name: string;
	stage: DealStage;
	currency: string;
	amountCents: number | null;
	weightedAmountCents: number | null;
	lastMovedAt: string;
	daysStuck: number;
	company: { id: string; name: string };
	owner: {
		id: string;
		name: string;
		email: string;
		image: string | null;
	};
};

function toCents(amount: Prisma.Decimal | null): number | null {
	return amount === null ? null : amount.times(100).toNumber();
}

/**
 * Last-7-day deal field changes + 14-day stuck open deals for a Me/Everyone
 * scope. Call from dashboard and agent tools alike.
 */
export async function loadPipelinePulse(
	db: PrismaClient,
	input: {
		scope: PipelinePulseScope;
		/** Required when `scope` is `"me"`. */
		userId?: string | null;
		now?: Date;
	},
): Promise<PipelinePulse> {
	const now = input.now ?? new Date();
	const mine = input.scope === "me";
	if (mine && !input.userId) {
		throw new Error('loadPipelinePulse: userId is required when scope is "me".');
	}

	const owned = mine && input.userId ? { ownerId: input.userId } : {};
	const pulseSince = new Date(now.getTime() - PULSE_WINDOW_DAYS * DAY_MS);
	const stuckBefore = new Date(now.getTime() - STUCK_DAYS * DAY_MS);

	const [changes, stuckCandidates] = await Promise.all([
		db.dealFieldChange.findMany({
			where: {
				createdAt: { gte: pulseSince },
				...(mine && input.userId ? { deal: { ownerId: input.userId } } : {}),
			},
			orderBy: [{ createdAt: "desc" }],
			take: 400,
			select: {
				id: true,
				field: true,
				fromValue: true,
				toValue: true,
				source: true,
				createdAt: true,
				actor: { select: OWNER_SELECT },
				deal: {
					select: {
						id: true,
						name: true,
						currency: true,
						company: { select: { id: true, name: true } },
						owner: { select: OWNER_SELECT },
					},
				},
			},
		}),
		db.deal.findMany({
			where: {
				...owned,
				stage: { in: [...OPEN_DEAL_STAGES] },
				stageChangedAt: { lt: stuckBefore },
			},
			orderBy: [{ stageChangedAt: "asc" }],
			take: 80,
			select: {
				id: true,
				name: true,
				stage: true,
				amount: true,
				weightedAmount: true,
				currency: true,
				stageChangedAt: true,
				company: { select: { id: true, name: true } },
				owner: { select: OWNER_SELECT },
				fieldChanges: {
					where: {
						field: { in: ["stage", "probability"] },
						createdAt: { gte: stuckBefore },
					},
					take: 1,
					select: { id: true },
				},
			},
		}),
	]);

	const counts = {
		won: 0,
		lost: 0,
		certainty: 0,
		stage: 0,
		amount: 0,
		expectedClose: 0,
		owner: 0,
		priority: 0,
		sageStage: 0,
		total: changes.length,
	};

	const moverCandidates: Array<{
		change: (typeof changes)[number];
		magnitude: number;
	}> = [];

	for (const change of changes) {
		switch (change.field) {
			case "stage":
				if (change.toValue === DealStage.CLOSED_WON) counts.won += 1;
				else if (change.toValue === DealStage.CLOSED_LOST) counts.lost += 1;
				else counts.stage += 1;
				moverCandidates.push({ change, magnitude: 1 });
				break;
			case "probability":
				counts.certainty += 1;
				moverCandidates.push({
					change,
					magnitude: Math.abs(
						(Number(change.toValue) || 0) - (Number(change.fromValue) || 0),
					),
				});
				break;
			case "amount":
				counts.amount += 1;
				moverCandidates.push({
					change,
					magnitude: Math.abs(
						(Number(change.toValue) || 0) - (Number(change.fromValue) || 0),
					),
				});
				break;
			case "expectedCloseDate":
				counts.expectedClose += 1;
				break;
			case "ownerId":
				counts.owner += 1;
				break;
			case "priority":
				counts.priority += 1;
				break;
			case "sageStage":
				counts.sageStage += 1;
				break;
			default:
				break;
		}
	}

	const movers = [...moverCandidates]
		.filter((row) =>
			["stage", "probability", "amount"].includes(row.change.field),
		)
		.sort((a, b) => b.magnitude - a.magnitude)
		.slice(0, PULSE_MOVERS_LIMIT)
		.map(({ change, magnitude }) => serializeChange(change, magnitude));

	const recent = changes
		.slice(0, PULSE_FEED_LIMIT)
		.map((change) => serializeChange(change));

	const stuck = stuckCandidates
		.filter((deal) => deal.fieldChanges.length === 0)
		.slice(0, PULSE_STUCK_LIMIT)
		.map((deal) => {
			const daysStuck = Math.max(
				1,
				Math.floor((now.getTime() - deal.stageChangedAt.getTime()) / DAY_MS),
			);
			return {
				id: deal.id,
				name: deal.name,
				stage: deal.stage,
				currency: deal.currency,
				amountCents: toCents(deal.amount),
				weightedAmountCents: toCents(deal.weightedAmount),
				lastMovedAt: deal.stageChangedAt.toISOString(),
				daysStuck,
				company: deal.company,
				owner: deal.owner,
			};
		});

	return {
		windowDays: PULSE_WINDOW_DAYS,
		stuckDays: STUCK_DAYS,
		since: pulseSince.toISOString(),
		scope: input.scope,
		counts,
		movers,
		recent,
		stuck,
	};
}

function serializeChange(
	change: {
		id: string;
		field: string;
		fromValue: string | null;
		toValue: string | null;
		source: string;
		createdAt: Date;
		actor: PulseChange["actor"];
		deal: PulseChange["deal"];
	},
	magnitude?: number,
): PulseChange {
	return {
		id: change.id,
		field: change.field,
		fromValue: change.fromValue,
		toValue: change.toValue,
		source: change.source as "app" | "sage",
		createdAt: change.createdAt.toISOString(),
		magnitude: magnitude ?? null,
		actor: change.actor,
		deal: change.deal,
	};
}
