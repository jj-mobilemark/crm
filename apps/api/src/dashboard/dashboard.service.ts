import {
	ActivityType,
	type Db,
	DealStage,
	loadPipelinePulse,
	type Prisma,
} from "@crm/db";
import { Injectable } from "@nestjs/common";
import { toCents } from "../crm/values";
import { InjectDatabase } from "../database/database.constants";
import { OPEN_DEAL_STAGES } from "../deals/deal-stage";
import type {
	DashboardRepSummaryInput,
	DashboardSummaryInput,
} from "./dashboard.contracts";

const OWNER_SELECT = {
	id: true,
	name: true,
	email: true,
	image: true,
} as const;

/** Cap so a multi-year custom range does not draw fifty x-axis ticks. */
const TREND_MONTHS_MAX = 24;

/** Floor when the selected range is shorter than one month (Today / This week). */
const TREND_MONTHS_MIN = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Feb". The chart has room for three letters, not "February". */
const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "short" });

/**
 * Dollars for a KPI or chart point.
 *
 * Sage often leaves `total` (`amount`) at null/0 and puts revenue in `forecast`
 * (`weightedAmount`). `??` alone is not enough: Postgres `SUM` of zeros is `0`,
 * not null, and `0 ?? weighted` keeps the zero — which is why Open pipeline
 * stayed at $0 beside a $13M weighted forecast.
 */
function dealMoneyCents(
	amount: Prisma.Decimal | null | undefined,
	weightedAmount: Prisma.Decimal | null | undefined,
): number {
	const amountCents = toCents(amount ?? null);
	const weightedCents = toCents(weightedAmount ?? null);
	if (amountCents !== null && amountCents !== 0) return amountCents;
	if (weightedCents !== null && weightedCents !== 0) return weightedCents;
	return amountCents ?? weightedCents ?? 0;
}

/**
 * Month buckets for the trend chart — aligned to the selected closed-won range,
 * not a fixed trailing six months.
 */
function trendWindow(
	rangeStart: Date,
	rangeEnd: Date,
): {
	start: Date;
	count: number;
} {
	const endMonth = monthStart(rangeEnd, 0);
	let start = monthStart(rangeStart, 0);
	let count = monthKey(endMonth) - monthKey(start) + 1;
	if (count > TREND_MONTHS_MAX) {
		start = monthStart(endMonth, -(TREND_MONTHS_MAX - 1));
		count = TREND_MONTHS_MAX;
	}
	return { start, count: Math.max(TREND_MONTHS_MIN, count) };
}

/** Local month boundary, `offset` months from the one `from` falls in. */
function monthStart(from: Date, offset: number): Date {
	return new Date(from.getFullYear(), from.getMonth() + offset, 1);
}

/** Local calendar day at 00:00. */
function dayStart(from: Date): Date {
	return new Date(from.getFullYear(), from.getMonth(), from.getDate());
}

/** Monday 00:00 of the week that contains `from` (ISO week, Mon–Sun). */
function weekStart(from: Date): Date {
	const day = dayStart(from);
	const weekday = day.getDay(); // 0 Sun … 6 Sat
	const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
	day.setDate(day.getDate() - daysFromMonday);
	return day;
}

/** Parse a `YYYY-MM-DD` as a local calendar day (not UTC midnight). */
function parseDay(day: string): Date {
	const parts = day.split("-").map(Number);
	const year = parts[0] ?? 0;
	const month = parts[1] ?? 1;
	const date = parts[2] ?? 1;
	return new Date(year, month - 1, date);
}

/** Exclusive end: the day after `day` at 00:00, so `closedAt < end` is inclusive. */
function dayAfter(day: Date): Date {
	return new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
}

/** Months since year zero — subtract two to get a bucket index. */
function monthKey(date: Date): number {
	return date.getFullYear() * 12 + date.getMonth();
}

type ResolvedRange = {
	preset: DashboardSummaryInput["range"];
	label: string;
	/** Inclusive start of the closed-won / performance window. */
	start: Date;
	/** Exclusive end of the window (usually "now", or the day after `to`). */
	end: Date;
	previousStart: Date;
	previousEnd: Date;
	windowDays: number;
};

/**
 * Closed-won and win-rate window from the overview URL.
 *
 * Open pipeline and forecast ignore this. A short preset (Today) still gets a
 * previous period of the same length so the delta label stays comparable.
 */
function resolveRange(input: DashboardSummaryInput, now: Date): ResolvedRange {
	const end = now;

	if (
		input.range === "custom" &&
		input.from &&
		input.to &&
		input.from <= input.to
	) {
		const start = parseDay(input.from);
		const toDay = parseDay(input.to);
		const customEnd = dayAfter(toDay);
		// Cap at now so a future `to` does not invent closed deals.
		const resolvedEnd = customEnd.getTime() > now.getTime() ? now : customEnd;
		const duration = Math.max(resolvedEnd.getTime() - start.getTime(), DAY_MS);
		return {
			preset: "custom",
			label: "Custom",
			start,
			end: resolvedEnd,
			previousStart: new Date(start.getTime() - duration),
			previousEnd: start,
			windowDays: Math.max(1, Math.ceil(duration / DAY_MS)),
		};
	}

	if (input.range === "today") {
		const start = dayStart(now);
		const duration = Math.max(end.getTime() - start.getTime(), DAY_MS);
		return {
			preset: "today",
			label: "Today",
			start,
			end,
			previousStart: new Date(start.getTime() - duration),
			previousEnd: start,
			windowDays: 1,
		};
	}

	if (input.range === "this_week") {
		const start = weekStart(now);
		const duration = Math.max(end.getTime() - start.getTime(), DAY_MS);
		return {
			preset: "this_week",
			label: "This week",
			start,
			end,
			previousStart: new Date(start.getTime() - duration),
			previousEnd: start,
			windowDays: Math.max(1, Math.ceil(duration / DAY_MS)),
		};
	}

	if (input.range === "past_30") {
		const start = new Date(now.getTime() - 30 * DAY_MS);
		return {
			preset: "past_30",
			label: "Past 30 days",
			start,
			end,
			previousStart: new Date(start.getTime() - 30 * DAY_MS),
			previousEnd: start,
			windowDays: 30,
		};
	}

	if (input.range === "this_month") {
		const start = monthStart(now, 0);
		const duration = Math.max(end.getTime() - start.getTime(), DAY_MS);
		return {
			preset: "this_month",
			label: "This month",
			start,
			end,
			previousStart: monthStart(now, -1),
			previousEnd: start,
			windowDays: Math.max(1, Math.ceil(duration / DAY_MS)),
		};
	}

	// this_year (default), and custom missing days — 1 Jan through now.
	const start = new Date(now.getFullYear(), 0, 1);
	const duration = Math.max(end.getTime() - start.getTime(), DAY_MS);
	const previousStart = new Date(now.getFullYear() - 1, 0, 1);
	return {
		preset: "this_year",
		label: "Since the 1st of the year",
		start,
		end,
		previousStart,
		previousEnd: new Date(previousStart.getTime() + duration),
		windowDays: Math.max(1, Math.ceil(duration / DAY_MS)),
	};
}

@Injectable()
export class DashboardService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	/**
	 * How the rep is doing: what they have closed, what is still open, the rates
	 * that describe how they sell, and what needs attention today.
	 *
	 * The open pipeline spans all history, so it is aggregated in Postgres — the
	 * alternative is a page that gets slower every quarter. Everything derived
	 * from closed and newly created deals comes off one bounded read of the last
	 * six months (and the selected range, when it reaches further back) and is
	 * folded up here: that window does not grow with history, it is a single
	 * index scan instead of a dozen aggregates, and it keeps the KPI strip and
	 * the chart underneath it on exactly the same month boundaries rather than
	 * letting SQL's idea of a month drift from JavaScript's.
	 */
	async summary(actingUserId: string, input: DashboardSummaryInput) {
		const mine = input.scope === "me";
		const owned = mine ? { ownerId: actingUserId } : {};

		const now = new Date();
		const range = resolveRange(input, now);
		const startOfMonth = monthStart(now, 0);
		const startOfNextMonth = monthStart(now, 1);
		const { start: trendStart, count: trendMonths } = trendWindow(
			range.start,
			range.end,
		);
		// Recent-deals read must cover the trend chart, the selected range, and
		// the prior comparable window — whichever starts earliest.
		const recentStart = new Date(
			Math.min(
				trendStart.getTime(),
				range.start.getTime(),
				range.previousStart.getTime(),
			),
		);

		const [
			openByStage,
			recentDeals,
			closingThisMonthTotals,
			openForecastDeals,
			biggestOpen,
			overdueTasks,
			recentActivity,
			pulse,
		] = await Promise.all([
			this.db.deal.groupBy({
				by: ["stage"],
				where: { ...owned, stage: { in: [...OPEN_DEAL_STAGES] } },
				_count: { _all: true },
				_sum: { amount: true, weightedAmount: true },
			}),
			// One read covers the trend chart, the selected range vs. prior, and
			// the win-rate window. Money columns stay narrow.
			this.db.deal.findMany({
				where: {
					...owned,
					OR: [
						{ createdAt: { gte: recentStart } },
						{ closedAt: { gte: recentStart } },
					],
				},
				select: {
					amount: true,
					weightedAmount: true,
					stage: true,
					createdAt: true,
					closedAt: true,
				},
			}),
			// A count and a sum, not rows: the KPI strip quotes "due this month"
			// as one figure, and no list on the page shows the deals behind it.
			this.db.deal.aggregate({
				where: {
					...owned,
					stage: { in: [...OPEN_DEAL_STAGES] },
					expectedCloseDate: { gte: startOfMonth, lt: startOfNextMonth },
				},
				_count: { _all: true },
				_sum: { amount: true, weightedAmount: true },
			}),
			// Open pipeline for the forecast view: group by close month + owner
			// in JS so month buckets follow the server calendar (same as closing
			// facets). Narrow select — only money, date, and owner identity.
			this.db.deal.findMany({
				where: { ...owned, stage: { in: [...OPEN_DEAL_STAGES] } },
				select: {
					amount: true,
					weightedAmount: true,
					expectedCloseDate: true,
					owner: { select: OWNER_SELECT },
				},
			}),
			this.db.deal.findMany({
				where: { ...owned, stage: { in: [...OPEN_DEAL_STAGES] } },
				orderBy: [
					{ weightedAmount: { sort: "desc", nulls: "last" } },
					{ amount: { sort: "desc", nulls: "last" } },
					{ expectedCloseDate: "asc" },
				],
				take: 6,
				select: {
					id: true,
					name: true,
					stage: true,
					amount: true,
					weightedAmount: true,
					currency: true,
					expectedCloseDate: true,
					stageChangedAt: true,
					company: { select: { id: true, name: true, iconUrl: true } },
					owner: { select: OWNER_SELECT },
				},
			}),
			// Always the acting user's, in either scope: nobody else's tasks are
			// theirs to tick off.
			this.db.activity.findMany({
				where: {
					type: ActivityType.TASK,
					completedAt: null,
					dueAt: { lt: now },
					createdById: actingUserId,
				},
				orderBy: [{ dueAt: "asc" }],
				take: 10,
				select: {
					id: true,
					subject: true,
					dueAt: true,
					priority: true,
					company: { select: { id: true, name: true } },
					deal: { select: { id: true, name: true } },
				},
			}),
			this.db.activity.findMany({
				where: mine ? { createdById: actingUserId } : {},
				orderBy: [{ createdAt: "desc" }],
				take: 12,
				select: {
					id: true,
					type: true,
					subject: true,
					body: true,
					createdAt: true,
					meta: true,
					createdBy: { select: OWNER_SELECT },
					company: { select: { id: true, name: true } },
					deal: { select: { id: true, name: true } },
				},
			}),
			// Pulse: shared helper — same shape the agent tool reads.
			// Change counts follow the overview date range; stuck stays 14d+.
			loadPipelinePulse(this.db, {
				scope: input.scope,
				userId: actingUserId,
				now,
				since: range.start,
				until: range.end,
			}),
		]);

		const stages = OPEN_DEAL_STAGES.map((stage) => {
			const group = openByStage.find((row) => row.stage === stage);
			return {
				stage: stage as DealStage,
				count: group?._count._all ?? 0,
				valueCents: dealMoneyCents(
					group?._sum.amount,
					group?._sum.weightedAmount,
				),
			};
		});

		const firstBucket = monthKey(trendStart);
		const trend = Array.from({ length: trendMonths }, (_, index) => ({
			month: MONTH_LABEL.format(monthStart(trendStart, index)),
			won: 0,
			created: 0,
		}));

		const wonInRange = { count: 0, valueCents: 0 };
		const wonPrevRange = { count: 0, valueCents: 0 };
		let wins = 0;
		let losses = 0;
		let wonCents = 0;
		let cycleDays = 0;

		for (const deal of recentDeals) {
			const cents = dealMoneyCents(deal.amount, deal.weightedAmount);

			// A deal closed inside the window but opened before it lands in no
			// created bucket — the index is negative, and the lookup misses.
			const created = trend[monthKey(deal.createdAt) - firstBucket];
			if (created) created.created += cents;

			const { closedAt, stage } = deal;
			if (!closedAt) continue;
			const won = stage === DealStage.CLOSED_WON;

			if (won) {
				const closed = trend[monthKey(closedAt) - firstBucket];
				if (closed) closed.won += cents;

				if (closedAt >= range.start && closedAt < range.end) {
					wonInRange.count += 1;
					wonInRange.valueCents += cents;
				} else if (
					closedAt >= range.previousStart &&
					closedAt < range.previousEnd
				) {
					wonPrevRange.count += 1;
					wonPrevRange.valueCents += cents;
				}
			}

			// Win rate uses the same selected window as Closed won — not a fixed
			// 90 days — so flipping the range control moves both numbers together.
			if (closedAt < range.start || closedAt >= range.end) continue;
			if (won) {
				wins += 1;
				wonCents += cents;
				cycleDays += (closedAt.getTime() - deal.createdAt.getTime()) / DAY_MS;
			} else if (stage === DealStage.CLOSED_LOST) {
				// Disqualified deals are deliberately neither: they never reached a
				// decision, so counting them would turn the win rate into a
				// measure of lead quality.
				losses += 1;
			}
		}

		const decided = wins + losses;

		const forecast = buildForecast(openForecastDeals, now);

		return {
			scope: input.scope,
			range: {
				preset: range.preset,
				label: range.label,
				start: range.start.toISOString(),
				end: range.end.toISOString(),
				windowDays: range.windowDays,
			},
			pipeline: {
				stages,
				totalCents: stages.reduce((total, s) => total + s.valueCents, 0),
				totalDeals: stages.reduce((total, s) => total + s.count, 0),
			},
			/** Closed won inside the selected range (field name kept for callers). */
			wonThisMonth: wonInRange,
			/** Closed won in the prior comparable window. */
			wonPrevMonth: wonPrevRange,
			/** Rates over the selected range. `null` where nothing has closed. */
			performance: {
				windowDays: range.windowDays,
				wins,
				losses,
				winRate: decided === 0 ? null : wins / decided,
				avgDealCents: wins === 0 ? null : Math.round(wonCents / wins),
				avgCycleDays: wins === 0 ? null : Math.round(cycleDays / wins),
			},
			/** Closed-won vs created, month buckets spanning the selected range. */
			trend,
			closingThisMonthTotal: {
				count: closingThisMonthTotals._count._all,
				valueCents: toCents(closingThisMonthTotals._sum.amount) ?? 0,
				weightedCents: toCents(closingThisMonthTotals._sum.weightedAmount) ?? 0,
			},
			/**
			 * Sage-style forecast: open deals by expected-close month, with
			 * unweighted (`amount`) and weighted (`weightedAmount`) totals.
			 */
			forecast,
			/**
			 * Deal-field moves in the selected range + stuck open deals (14d+).
			 * Stuck ignores the date control; change counts follow it.
			 */
			pulse,
			biggestOpen: biggestOpen.map(
				({
					amount,
					weightedAmount,
					expectedCloseDate,
					stageChangedAt,
					...deal
				}) => ({
					...deal,
					amountCents: toCents(amount),
					weightedAmountCents: toCents(weightedAmount),
					expectedCloseDate: expectedCloseDate?.toISOString() ?? null,
					stageChangedAt: stageChangedAt.toISOString(),
				}),
			),
			overdueTasks: overdueTasks.map(({ dueAt, ...task }) => ({
				...task,
				dueAt: dueAt?.toISOString() ?? null,
			})),
			recentActivity: recentActivity.map(({ createdAt, meta, ...entry }) => ({
				...entry,
				createdAt: createdAt.toISOString(),
				meta: meta as Record<string, unknown> | null,
			})),
		};
	}

	/**
	 * Manager slide-out for one rep: KPIs, certainty × close-month grid (current
	 * + next two months), open deals, companies, stuck, and recent field moves.
	 */
	async repSummary(input: DashboardRepSummaryInput) {
		const user = await this.db.user.findUnique({
			where: { id: input.userId },
			select: OWNER_SELECT,
		});
		if (!user) return null;

		const now = new Date();
		const range = resolveRange(
			{
				scope: "everyone",
				range: input.range,
				from: input.from,
				to: input.to,
			},
			now,
		);
		const owned = { ownerId: input.userId };
		const startOfMonth = monthStart(now, 0);
		const startOfNextMonth = monthStart(now, 1);
		const monthEnds = [0, 1, 2].map((offset) => ({
			offset,
			start: monthStart(now, offset),
			end: monthStart(now, offset + 1),
			key: `${monthStart(now, offset).getFullYear()}-${String(monthStart(now, offset).getMonth() + 1).padStart(2, "0")}`,
			label: FORECAST_MONTH_LABEL.format(monthStart(now, offset)),
		}));
		const certaintyHorizonEnd = monthStart(now, 3);

		const [
			openByStage,
			closedInRange,
			openDeals,
			certaintyDeals,
			companies,
			pulse,
			recentChanges,
		] = await Promise.all([
			this.db.deal.groupBy({
				by: ["stage"],
				where: { ...owned, stage: { in: [...OPEN_DEAL_STAGES] } },
				_count: { _all: true },
				_sum: { amount: true, weightedAmount: true },
			}),
			this.db.deal.findMany({
				where: {
					...owned,
					closedAt: { gte: range.start, lt: range.end },
					stage: {
						in: [DealStage.CLOSED_WON, DealStage.CLOSED_LOST],
					},
				},
				select: {
					stage: true,
					amount: true,
					weightedAmount: true,
				},
			}),
			this.db.deal.findMany({
				where: { ...owned, stage: { in: [...OPEN_DEAL_STAGES] } },
				orderBy: [
					{ expectedCloseDate: { sort: "asc", nulls: "last" } },
					{ weightedAmount: { sort: "desc", nulls: "last" } },
				],
				take: 50,
				select: {
					id: true,
					name: true,
					stage: true,
					amount: true,
					weightedAmount: true,
					probability: true,
					currency: true,
					expectedCloseDate: true,
					stageChangedAt: true,
					company: { select: { id: true, name: true, iconUrl: true } },
				},
			}),
			this.db.deal.findMany({
				where: {
					...owned,
					stage: { in: [...OPEN_DEAL_STAGES] },
					expectedCloseDate: {
						gte: startOfMonth,
						lt: certaintyHorizonEnd,
					},
				},
				select: {
					stage: true,
					amount: true,
					expectedCloseDate: true,
				},
			}),
			this.db.company.findMany({
				where: { ownerId: input.userId },
				orderBy: [{ name: "asc" }],
				take: 40,
				select: {
					id: true,
					name: true,
					iconUrl: true,
					_count: {
						select: {
							deals: { where: { stage: { in: [...OPEN_DEAL_STAGES] } } },
						},
					},
				},
			}),
			loadPipelinePulse(this.db, {
				scope: "me",
				userId: input.userId,
				now,
				since: range.start,
				until: range.end,
			}),
			this.db.dealFieldChange.findMany({
				where: {
					createdAt: { gte: range.start, lt: range.end },
					deal: { ownerId: input.userId },
				},
				orderBy: [{ createdAt: "desc" }],
				take: 24,
				select: {
					id: true,
					field: true,
					fromValue: true,
					toValue: true,
					source: true,
					createdAt: true,
					deal: {
						select: {
							id: true,
							name: true,
							company: { select: { id: true, name: true } },
						},
					},
				},
			}),
		]);

		const stages = OPEN_DEAL_STAGES.map((stage) => {
			const group = openByStage.find((row) => row.stage === stage);
			return {
				stage: stage as DealStage,
				count: group?._count._all ?? 0,
				amountCents: toCents(group?._sum.amount ?? null) ?? 0,
				weightedCents: toCents(group?._sum.weightedAmount ?? null) ?? 0,
			};
		});

		let wonCount = 0;
		let lostCount = 0;
		let wonCents = 0;
		for (const deal of closedInRange) {
			const cents = dealMoneyCents(deal.amount, deal.weightedAmount);
			if (deal.stage === DealStage.CLOSED_WON) {
				wonCount += 1;
				wonCents += cents;
			} else {
				lostCount += 1;
			}
		}
		const decided = wonCount + lostCount;

		const certaintyBreakdown = OPEN_DEAL_STAGES.map((stage) => ({
			stage: stage as DealStage,
			months: monthEnds.map((month) => {
				let amountCents = 0;
				let dealCount = 0;
				for (const deal of certaintyDeals) {
					if (deal.stage !== stage || !deal.expectedCloseDate) continue;
					const close = deal.expectedCloseDate;
					if (close >= month.start && close < month.end) {
						amountCents += toCents(deal.amount) ?? 0;
						dealCount += 1;
					}
				}
				return {
					key: month.key,
					label: month.label,
					amountCents,
					dealCount,
				};
			}),
		}));

		const closingThisMonth = openDeals.filter((deal) => {
			const close = deal.expectedCloseDate;
			return close !== null && close >= startOfMonth && close < startOfNextMonth;
		});

		return {
			user,
			range: {
				preset: range.preset,
				label: range.label,
				start: range.start.toISOString(),
				end: range.end.toISOString(),
				windowDays: range.windowDays,
			},
			kpis: {
				openPipelineCents: stages.reduce((t, s) => t + s.amountCents, 0),
				openWeightedCents: stages.reduce((t, s) => t + s.weightedCents, 0),
				openDealCount: stages.reduce((t, s) => t + s.count, 0),
				wonCount,
				wonCents,
				lostCount,
				winRate: decided === 0 ? null : wonCount / decided,
				stuckCount: pulse.stuck.length,
				closingThisMonthCount: closingThisMonth.length,
			},
			stages,
			certaintyMonths: monthEnds.map((m) => ({
				key: m.key,
				label: m.label,
			})),
			certaintyBreakdown,
			deals: openDeals.map(
				({
					amount,
					weightedAmount,
					expectedCloseDate,
					stageChangedAt,
					...deal
				}) => ({
					...deal,
					amountCents: toCents(amount),
					weightedAmountCents: toCents(weightedAmount),
					expectedCloseDate: expectedCloseDate?.toISOString() ?? null,
					stageChangedAt: stageChangedAt.toISOString(),
				}),
			),
			stuck: pulse.stuck,
			companies: companies.map((company) => ({
				id: company.id,
				name: company.name,
				iconUrl: company.iconUrl,
				openDealCount: company._count.deals,
			})),
			recentChanges: recentChanges.map(({ createdAt, ...row }) => ({
				...row,
				createdAt: createdAt.toISOString(),
			})),
		};
	}
}

type ForecastDeal = {
	amount: Prisma.Decimal | null;
	weightedAmount: Prisma.Decimal | null;
	expectedCloseDate: Date | null;
	owner: { id: string; name: string; email: string; image: string | null };
};

/** Month label with year — forecast spans more than one calendar year. */
const FORECAST_MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
	month: "short",
	year: "numeric",
});

/**
 * How far back the close-month table keeps overdue buckets. Older open deals
 * still count in totals / by-rep; they just leave the month list so 2021
 * close dates do not bury the live forecast.
 */
const FORECAST_MONTHS_LOOKBACK = 11;

/**
 * Bucket open deals by expected-close month (server calendar) and by owner.
 *
 * Months sort chronologically; deals with no close date land in a trailing
 * "No date" bucket. The month table keeps the last 12 months (including the
 * current month) plus any upcoming close months — older overdue months drop
 * out. Totals and by-owner still cover every open deal.
 */
function buildForecast(deals: ForecastDeal[], now: Date) {
	const monthBuckets = new Map<
		string,
		{
			key: string;
			label: string;
			sort: number;
			amountCents: number;
			weightedCents: number;
			dealCount: number;
		}
	>();
	const ownerBuckets = new Map<
		string,
		{
			owner: ForecastDeal["owner"];
			amountCents: number;
			weightedCents: number;
			dealCount: number;
		}
	>();

	let amountCents = 0;
	let weightedCents = 0;

	for (const deal of deals) {
		const amount = toCents(deal.amount) ?? 0;
		const weighted = toCents(deal.weightedAmount) ?? 0;
		amountCents += amount;
		weightedCents += weighted;

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

		const month = monthBuckets.get(key) ?? {
			key,
			label,
			sort,
			amountCents: 0,
			weightedCents: 0,
			dealCount: 0,
		};
		month.amountCents += amount;
		month.weightedCents += weighted;
		month.dealCount += 1;
		monthBuckets.set(key, month);

		const owner = ownerBuckets.get(deal.owner.id) ?? {
			owner: deal.owner,
			amountCents: 0,
			weightedCents: 0,
			dealCount: 0,
		};
		owner.amountCents += amount;
		owner.weightedCents += weighted;
		owner.dealCount += 1;
		ownerBuckets.set(deal.owner.id, owner);
	}

	const thisMonthKey = monthKey(now);
	const oldestMonthKey = monthKey(monthStart(now, -FORECAST_MONTHS_LOOKBACK));

	return {
		totals: {
			amountCents,
			weightedCents,
			dealCount: deals.length,
		},
		months: [...monthBuckets.values()]
			.filter((month) => month.key === "none" || month.sort >= oldestMonthKey)
			.sort((a, b) => a.sort - b.sort)
			.map(({ sort, ...month }) => ({
				...month,
				/** Past the current month and still open — the rep's overdue book. */
				overdue: sort < thisMonthKey,
			})),
		byOwner: [...ownerBuckets.values()].sort(
			(a, b) =>
				b.weightedCents - a.weightedCents || b.amountCents - a.amountCents,
		),
	};
}
