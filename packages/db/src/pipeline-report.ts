import { DealStage, type Prisma, type PrismaClient } from "./generated/prisma/client";
import type { PipelinePulseScope } from "./pipeline-pulse";

/**
 * Shared pipeline report queries — used by the agent's `read_pipeline_report`
 * tool. Mechanical only: open-by-stage, forecast-by-close-month, closing /
 * closed in a calendar month. No judgements.
 *
 * Month bounds use **server local** calendar time (same spirit as the overview
 * dashboard forecast). Prefer unweighted `amount` (deal value); include
 * `weightedAmount` as secondary. Never invent.
 */

export const REPORT_DEAL_LIMIT = 40;

const OPEN_DEAL_STAGES = [
	DealStage.DEMO_BOOKED,
	DealStage.QUALIFIED_TO_BUY,
	DealStage.DECISION_MAKER_BOUGHT_IN,
	DealStage.CONTRACT_SENT,
	DealStage.IN_PURCHASING,
] as const;

const CLOSED_DEAL_STAGES = [
	DealStage.CLOSED_WON,
	DealStage.CLOSED_LOST,
	DealStage.UNQUALIFIED_TO_BUY,
] as const;

const OWNER_SELECT = {
	id: true,
	name: true,
	email: true,
	image: true,
} as const;

const DEAL_LIST_SELECT = {
	id: true,
	name: true,
	stage: true,
	amount: true,
	weightedAmount: true,
	currency: true,
	expectedCloseDate: true,
	closedAt: true,
	company: { select: { id: true, name: true } },
	owner: { select: OWNER_SELECT },
} as const;

export type PipelineReportScope = PipelinePulseScope;

export type PipelineReportMode =
	| "open_by_stage"
	| "forecast_by_close_month"
	| "closing_in_month"
	| "closed_in_month";

export type PipelineReportDeal = {
	id: string;
	name: string;
	stage: DealStage;
	currency: string;
	amountCents: number | null;
	weightedAmountCents: number | null;
	expectedCloseDate: string | null;
	closedAt: string | null;
	company: { id: string; name: string };
	owner: {
		id: string;
		name: string;
		email: string;
		image: string | null;
	};
};

export type PipelineReportStageRow = {
	stage: DealStage;
	dealCount: number;
	amountCents: number;
	weightedAmountCents: number;
};

export type PipelineReportMonthRow = {
	key: string;
	label: string;
	dealCount: number;
	amountCents: number;
	weightedAmountCents: number;
	/** Past the current month and still open. */
	overdue: boolean;
};

export type PipelineReportClosedBucket = {
	stage: DealStage;
	dealCount: number;
	amountCents: number;
	weightedAmountCents: number;
};

export type PipelineReport = {
	mode: PipelineReportMode;
	scope: PipelineReportScope;
	month: string | null;
	totals: {
		dealCount: number;
		amountCents: number;
		weightedAmountCents: number;
	};
	byStage: PipelineReportStageRow[];
	byMonth: PipelineReportMonthRow[];
	closed: PipelineReportClosedBucket[];
	deals: PipelineReportDeal[];
	truncated: boolean;
};

const FORECAST_MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
	month: "short",
	year: "numeric",
});

const YEAR_MONTH_RE = /^(\d{4})-(\d{2})$/;

function toCents(amount: Prisma.Decimal | null): number | null {
	return amount === null ? null : amount.times(100).toNumber();
}

function centsOrZero(amount: Prisma.Decimal | null): number {
	return toCents(amount) ?? 0;
}

/** Months since year zero — subtract two to get a bucket index. */
function monthKey(date: Date): number {
	return date.getFullYear() * 12 + date.getMonth();
}

/**
 * Parse `YYYY-MM` into a year and 0-based month index.
 * Returns null when the string is not a real calendar month.
 */
export function parseYearMonth(
	month: string,
): { year: number; monthIndex: number } | null {
	const match = YEAR_MONTH_RE.exec(month);
	if (!match) return null;
	const year = Number(match[1]);
	const monthNumber = Number(match[2]);
	if (monthNumber < 1 || monthNumber > 12) return null;
	return { year, monthIndex: monthNumber - 1 };
}

/**
 * Inclusive start / exclusive end for a calendar month in **server local** time.
 */
export function calendarMonthBounds(
	year: number,
	monthIndex: number,
): { start: Date; end: Date } {
	const start = new Date(year, monthIndex, 1);
	const end = new Date(year, monthIndex + 1, 1);
	return { start, end };
}

/**
 * Owner filter for Me/Everyone. Throws when `scope` is `"me"` without a user id.
 */
export function reportOwnerWhere(
	scope: PipelineReportScope,
	userId?: string | null,
): { ownerId: string } | Record<string, never> {
	if (scope === "me") {
		if (!userId) {
			throw new Error(
				'loadPipelineReport: userId is required when scope is "me".',
			);
		}
		return { ownerId: userId };
	}
	return {};
}

function serializeDeal(deal: {
	id: string;
	name: string;
	stage: DealStage;
	currency: string;
	amount: Prisma.Decimal | null;
	weightedAmount: Prisma.Decimal | null;
	expectedCloseDate: Date | null;
	closedAt: Date | null;
	company: { id: string; name: string };
	owner: PipelineReportDeal["owner"];
}): PipelineReportDeal {
	return {
		id: deal.id,
		name: deal.name,
		stage: deal.stage,
		currency: deal.currency,
		amountCents: toCents(deal.amount),
		weightedAmountCents: toCents(deal.weightedAmount),
		expectedCloseDate: deal.expectedCloseDate?.toISOString() ?? null,
		closedAt: deal.closedAt?.toISOString() ?? null,
		company: deal.company,
		owner: deal.owner,
	};
}

function emptyReport(
	mode: PipelineReportMode,
	scope: PipelineReportScope,
	month: string | null,
): PipelineReport {
	return {
		mode,
		scope,
		month,
		totals: { dealCount: 0, amountCents: 0, weightedAmountCents: 0 },
		byStage: [],
		byMonth: [],
		closed: [],
		deals: [],
		truncated: false,
	};
}

function sumDeals(
	deals: Array<{
		amount: Prisma.Decimal | null;
		weightedAmount: Prisma.Decimal | null;
	}>,
): PipelineReport["totals"] {
	let amountCents = 0;
	let weightedAmountCents = 0;
	for (const deal of deals) {
		amountCents += centsOrZero(deal.amount);
		weightedAmountCents += centsOrZero(deal.weightedAmount);
	}
	return {
		dealCount: deals.length,
		amountCents,
		weightedAmountCents,
	};
}

function takeDeals(
	deals: Array<Parameters<typeof serializeDeal>[0]>,
	includeDeals: boolean,
): { deals: PipelineReportDeal[]; truncated: boolean } {
	if (!includeDeals) return { deals: [], truncated: false };
	const truncated = deals.length > REPORT_DEAL_LIMIT;
	return {
		deals: deals.slice(0, REPORT_DEAL_LIMIT).map(serializeDeal),
		truncated,
	};
}

/**
 * Mechanical pipeline report for Me/Everyone. Call from agent tools (and
 * Nest later if the dashboard wants the same shape).
 */
export async function loadPipelineReport(
	db: PrismaClient,
	input: {
		scope: PipelineReportScope;
		mode: PipelineReportMode;
		/** Required for `closing_in_month` / `closed_in_month`; optional filter for forecast. */
		month?: string | null;
		/** Required when `scope` is `"me"`. */
		userId?: string | null;
		includeDeals?: boolean;
		now?: Date;
	},
): Promise<PipelineReport> {
	const now = input.now ?? new Date();
	const includeDeals = input.includeDeals !== false;
	const owned = reportOwnerWhere(input.scope, input.userId);
	const month = input.month ?? null;

	if (
		(input.mode === "closing_in_month" || input.mode === "closed_in_month") &&
		!month
	) {
		throw new Error(
			`loadPipelineReport: month (YYYY-MM) is required for mode "${input.mode}".`,
		);
	}

	const parsed = month ? parseYearMonth(month) : null;
	if (month && !parsed) {
		throw new Error(
			`loadPipelineReport: month must be YYYY-MM (got "${month}").`,
		);
	}
	const bounds = parsed
		? calendarMonthBounds(parsed.year, parsed.monthIndex)
		: null;

	switch (input.mode) {
		case "open_by_stage":
			return loadOpenByStage(db, input.scope, owned, includeDeals);
		case "forecast_by_close_month":
			return loadForecastByCloseMonth(
				db,
				input.scope,
				owned,
				includeDeals,
				now,
				month,
				bounds,
			);
		case "closing_in_month":
			return loadClosingInMonth(
				db,
				input.scope,
				owned,
				includeDeals,
				month!,
				bounds!,
			);
		case "closed_in_month":
			return loadClosedInMonth(
				db,
				input.scope,
				owned,
				includeDeals,
				month!,
				bounds!,
			);
	}
}

async function loadOpenByStage(
	db: PrismaClient,
	scope: PipelineReportScope,
	owned: { ownerId: string } | Record<string, never>,
	includeDeals: boolean,
): Promise<PipelineReport> {
	const [grouped, deals] = await Promise.all([
		db.deal.groupBy({
			by: ["stage"],
			where: { ...owned, stage: { in: [...OPEN_DEAL_STAGES] } },
			_count: { _all: true },
			_sum: { amount: true, weightedAmount: true },
		}),
		includeDeals
			? db.deal.findMany({
					where: { ...owned, stage: { in: [...OPEN_DEAL_STAGES] } },
					orderBy: [
						{ amount: { sort: "desc", nulls: "last" } },
						{ name: "asc" },
					],
					select: DEAL_LIST_SELECT,
				})
			: Promise.resolve([]),
	]);

	const byStageMap = new Map(
		grouped.map((row) => [
			row.stage,
			{
				stage: row.stage,
				dealCount: row._count._all,
				amountCents: toCents(row._sum.amount) ?? 0,
				weightedAmountCents: toCents(row._sum.weightedAmount) ?? 0,
			} satisfies PipelineReportStageRow,
		]),
	);

	const byStage = OPEN_DEAL_STAGES.map(
		(stage) =>
			byStageMap.get(stage) ?? {
				stage,
				dealCount: 0,
				amountCents: 0,
				weightedAmountCents: 0,
			},
	);

	const totals = byStage.reduce(
		(acc, row) => ({
			dealCount: acc.dealCount + row.dealCount,
			amountCents: acc.amountCents + row.amountCents,
			weightedAmountCents: acc.weightedAmountCents + row.weightedAmountCents,
		}),
		{ dealCount: 0, amountCents: 0, weightedAmountCents: 0 },
	);

	const listed = takeDeals(deals, includeDeals);
	return {
		...emptyReport("open_by_stage", scope, null),
		totals,
		byStage,
		...listed,
	};
}

async function loadForecastByCloseMonth(
	db: PrismaClient,
	scope: PipelineReportScope,
	owned: { ownerId: string } | Record<string, never>,
	includeDeals: boolean,
	now: Date,
	month: string | null,
	bounds: { start: Date; end: Date } | null,
): Promise<PipelineReport> {
	const where = {
		...owned,
		stage: { in: [...OPEN_DEAL_STAGES] },
		...(bounds
			? { expectedCloseDate: { gte: bounds.start, lt: bounds.end } }
			: {}),
	};

	const deals = await db.deal.findMany({
		where,
		orderBy: [
			{ expectedCloseDate: "asc" },
			{ amount: { sort: "desc", nulls: "last" } },
		],
		select: DEAL_LIST_SELECT,
	});

	const thisMonthKey = monthKey(now);
	const monthBuckets = new Map<
		string,
		PipelineReportMonthRow & { sort: number }
	>();

	for (const deal of deals) {
		const amount = centsOrZero(deal.amount);
		const weighted = centsOrZero(deal.weightedAmount);
		const close = deal.expectedCloseDate;
		const key = close
			? `${close.getFullYear()}-${String(close.getMonth() + 1).padStart(2, "0")}`
			: "none";
		const label = close
			? FORECAST_MONTH_LABEL.format(
					new Date(close.getFullYear(), close.getMonth(), 1),
				)
			: "No date";
		const sort = close ? monthKey(close) : Number.POSITIVE_INFINITY;
		const bucket = monthBuckets.get(key) ?? {
			key,
			label,
			sort,
			dealCount: 0,
			amountCents: 0,
			weightedAmountCents: 0,
			overdue: false,
		};
		bucket.dealCount += 1;
		bucket.amountCents += amount;
		bucket.weightedAmountCents += weighted;
		monthBuckets.set(key, bucket);
	}

	const byMonth = [...monthBuckets.values()]
		.sort((a, b) => a.sort - b.sort)
		.map(({ sort, ...row }) => ({
			...row,
			overdue: Number.isFinite(sort) && sort < thisMonthKey,
		}));

	const listed = takeDeals(deals, includeDeals);
	return {
		...emptyReport("forecast_by_close_month", scope, month),
		totals: sumDeals(deals),
		byMonth,
		...listed,
	};
}

async function loadClosingInMonth(
	db: PrismaClient,
	scope: PipelineReportScope,
	owned: { ownerId: string } | Record<string, never>,
	includeDeals: boolean,
	month: string,
	bounds: { start: Date; end: Date },
): Promise<PipelineReport> {
	const deals = await db.deal.findMany({
		where: {
			...owned,
			stage: { in: [...OPEN_DEAL_STAGES] },
			expectedCloseDate: { gte: bounds.start, lt: bounds.end },
		},
		orderBy: [
			{ amount: { sort: "desc", nulls: "last" } },
			{ expectedCloseDate: "asc" },
		],
		select: DEAL_LIST_SELECT,
	});

	const byStageMap = new Map<DealStage, PipelineReportStageRow>();
	for (const deal of deals) {
		const row = byStageMap.get(deal.stage) ?? {
			stage: deal.stage,
			dealCount: 0,
			amountCents: 0,
			weightedAmountCents: 0,
		};
		row.dealCount += 1;
		row.amountCents += centsOrZero(deal.amount);
		row.weightedAmountCents += centsOrZero(deal.weightedAmount);
		byStageMap.set(deal.stage, row);
	}

	const listed = takeDeals(deals, includeDeals);
	return {
		...emptyReport("closing_in_month", scope, month),
		totals: sumDeals(deals),
		byStage: OPEN_DEAL_STAGES.flatMap((stage) => {
			const row = byStageMap.get(stage);
			return row ? [row] : [];
		}),
		...listed,
	};
}

async function loadClosedInMonth(
	db: PrismaClient,
	scope: PipelineReportScope,
	owned: { ownerId: string } | Record<string, never>,
	includeDeals: boolean,
	month: string,
	bounds: { start: Date; end: Date },
): Promise<PipelineReport> {
	const deals = await db.deal.findMany({
		where: {
			...owned,
			stage: { in: [...CLOSED_DEAL_STAGES] },
			closedAt: { gte: bounds.start, lt: bounds.end },
		},
		orderBy: [
			{ closedAt: "desc" },
			{ amount: { sort: "desc", nulls: "last" } },
		],
		select: DEAL_LIST_SELECT,
	});

	const closedMap = new Map<DealStage, PipelineReportClosedBucket>();
	for (const deal of deals) {
		const row = closedMap.get(deal.stage) ?? {
			stage: deal.stage,
			dealCount: 0,
			amountCents: 0,
			weightedAmountCents: 0,
		};
		row.dealCount += 1;
		row.amountCents += centsOrZero(deal.amount);
		row.weightedAmountCents += centsOrZero(deal.weightedAmount);
		closedMap.set(deal.stage, row);
	}

	const listed = takeDeals(deals, includeDeals);
	return {
		...emptyReport("closed_in_month", scope, month),
		totals: sumDeals(deals),
		closed: CLOSED_DEAL_STAGES.flatMap((stage) => {
			const row = closedMap.get(stage);
			return row ? [row] : [];
		}),
		...listed,
	};
}
