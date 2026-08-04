"use client";

import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import type { ChartConfig } from "@crm/ui/components/chart";
import { DashboardRow, StatGroup } from "@crm/ui/components/dashboard";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import {
	SimpleTable,
	type SimpleTableColumn,
	SimpleTableRow,
} from "@crm/ui/components/simple-table";
import { StatCard, type StatDelta } from "@crm/ui/components/stat-card";
import { TableCell } from "@crm/ui/components/table";
import {
	formatCount,
	formatMoney,
	formatMoneyCompact,
	formatPercent,
} from "@crm/ui/lib/format";
import Link from "next/link";
import type { ReactNode } from "react";
import { dealStageColor, dealStageLabel } from "@/components/crm/deal-stage";
import { OwnerCell } from "@/components/crm/owner-cell";
import { AreaTrend, DonutStat } from "@/components/dashboard-charts";
import type { RouterOutputs } from "@/lib/trpc/types";

type Summary = RouterOutputs["dashboard"]["summary"];

const EMPTY_FORECAST: Summary["forecast"] = {
	totals: { amountCents: 0, weightedCents: 0, dealCount: 0 },
	months: [],
	byOwner: [],
};

const EMPTY_PULSE: NonNullable<Summary["pulse"]> = {
	windowDays: 7,
	stuckDays: 14,
	since: new Date(0).toISOString(),
	until: new Date(0).toISOString(),
	scope: "me",
	counts: {
		won: 0,
		lost: 0,
		certainty: 0,
		stage: 0,
		amount: 0,
		expectedClose: 0,
		owner: 0,
		priority: 0,
		sageStage: 0,
		total: 0,
	},
	movers: [],
	recent: [],
	stuck: [],
};

const CELL = "px-3 py-2.5 align-middle";

/**
 * Won is the outcome, created is the input that produces it six weeks later.
 * `--success` for the first because a rep already reads green as "closed"; the
 * chart ramp for the second because it is a leading indicator, not a verdict.
 */
const TREND_CONFIG: ChartConfig = {
	won: { label: "Closed won", color: "var(--success)" },
	created: { label: "New pipeline", color: "var(--chart-1)" },
};

/**
 * Percentage change, or nothing.
 *
 * With no baseline there is no percentage to quote — "+100%" against a month
 * where nothing closed is arithmetic, not information.
 */
function changeDelta(
	current: number,
	previous: number,
	label: string,
): StatDelta | undefined {
	if (previous === 0) return undefined;
	const change = Math.round(((current - previous) / previous) * 100);
	return {
		value: `${change >= 0 ? "+" : ""}${change}%`,
		direction: change > 0 ? "up" : change < 0 ? "down" : "neutral",
		label,
	};
}

/**
 * The KPI strip (eight cells) and the charts behind it: closed-won against new
 * pipeline, and where the open pipeline currently sits.
 *
 * Cells that ignore the date range (due this month, open pipeline, stuck) use
 * `tone="static"`. Cells that follow the range animate on change.
 */
export function SalesDashboard({ summary }: { summary: Summary }) {
	const {
		pipeline,
		wonThisMonth,
		wonPrevMonth,
		performance,
		trend,
		closingThisMonthTotal,
	} = summary;
	// Stale dehydrated/cached summaries (pre-forecast API) omit this field —
	// fall back so the overview still paints while the query refetches.
	const forecast = summary.forecast ?? EMPTY_FORECAST;
	const pulse = summary.pulse ?? EMPTY_PULSE;
	const rangeLabel = summary.range?.label ?? "Year to date";
	// Unweighted close-this-month total. Fall back to weighted only when amount
	// is empty — same idea as dealMoneyCents, so a Sage deal that only has
	// forecast still shows up while certainty is still noisy as a KPI.
	const dueThisMonthCents =
		closingThisMonthTotal.valueCents !== 0
			? closingThisMonthTotal.valueCents
			: (closingThisMonthTotal.weightedCents ?? 0);

	const hasTrend = trend.some((point) => point.won > 0 || point.created > 0);

	const stageSlices = pipeline.stages
		.map((stage) => ({
			key: stage.stage,
			label: dealStageLabel(stage.stage),
			value: stage.valueCents,
			color: dealStageColor(stage.stage),
			count: stage.count,
		}))
		.filter((slice) => slice.value > 0);

	const showOwnerBreakdown =
		summary.scope === "everyone" && forecast.byOwner.length > 1;

	const monthColumns: SimpleTableColumn[] = [
		{ header: "Close month" },
		{ header: "Deals", width: "w-16", align: "right" },
		{ header: "Amount", width: "w-24", align: "right" },
		{ header: "Weighted", width: "w-24", align: "right" },
	];

	const ownerColumns: SimpleTableColumn[] = [
		{ header: "Rep" },
		{ header: "Deals", width: "w-16", align: "right" },
		{ header: "Amount", width: "w-24", align: "right" },
		{ header: "Weighted", width: "w-24", align: "right" },
	];

	const { counts, stuck } = pulse;

	return (
		<div className="flex flex-col gap-6">
			<StatGroup>
				<StatCard
					label="Closed won"
					value={formatMoneyCompact(wonThisMonth.valueCents)}
					animate
					delta={changeDelta(
						wonThisMonth.valueCents,
						wonPrevMonth.valueCents,
						"vs. prior period",
					)}
					description={`${rangeLabel} · ${formatCount(wonThisMonth.count, "deal")} · ${formatMoneyCompact(wonPrevMonth.valueCents)} prior`}
				/>
				<StatCard
					label="Due this month"
					tone="static"
					value={formatMoneyCompact(dueThisMonthCents)}
					description={`${formatCount(closingThisMonthTotal.count, "open deal")} with a close date this month`}
				/>
				<StatCard
					label="Open pipeline"
					tone="static"
					value={formatMoneyCompact(pipeline.totalCents)}
					description={`${formatCount(pipeline.totalDeals, "deal")} in progress · ${formatMoneyCompact(forecast.totals.weightedCents)} weighted`}
				/>
				<StatCard
					label={`Win rate (${performance.windowDays}d)`}
					value={
						performance.winRate === null
							? "—"
							: formatPercent(performance.winRate)
					}
					animate
					description={
						performance.wins + performance.losses === 0
							? "Nothing has closed yet"
							: `${performance.wins} won · ${performance.losses} lost`
					}
				/>
				<StatCard
					label="Won"
					value={counts.won}
					animate
					description={`${rangeLabel} · stage moves to won`}
				/>
				<StatCard
					label="Lost"
					value={counts.lost}
					animate
					description={`${rangeLabel} · stage moves to lost`}
				/>
				<StatCard
					label="Certainty moves"
					value={counts.certainty}
					animate
					description={`${formatCount(counts.stage, "stage move")} · ${formatCount(counts.amount, "amount move")}`}
				/>
				<StatCard
					label="Stuck"
					tone="static"
					value={stuck.length}
					description={`Open, no stage/certainty move in ${pulse.stuckDays}d+`}
				/>
			</StatGroup>

			<DashboardRow split="hero">
				<ChartPanel
					title="Closed won vs. new pipeline"
					description={`${rangeLabel} · by the month a deal closed or was created`}
				>
					{hasTrend ? (
						<div className="flex flex-1 flex-col justify-center py-4">
							<AreaTrend
								data={trend}
								config={TREND_CONFIG}
								xKey="month"
								height={196}
								variant="gradient"
								bloom="high"
								showLegend
								formatValue={(value) =>
									formatMoney(typeof value === "number" ? value : Number(value))
								}
							/>
						</div>
					) : (
						<EmptyChart label="No deals closed or created yet" />
					)}
				</ChartPanel>

				<ChartPanel
					title="Open pipeline by stage"
					description="Where the value sits right now"
				>
					{stageSlices.length > 0 ? (
						<div className="flex flex-1 flex-col justify-between gap-1 pt-4">
							<DonutStat
								data={stageSlices}
								height={168}
								centerValue={formatMoneyCompact(pipeline.totalCents)}
								centerLabel="open"
								formatValue={(value) =>
									formatMoney(typeof value === "number" ? value : Number(value))
								}
							/>
							{/*
							 * A legend of links rather than `onSliceClick`: clicking a
							 * wedge is pointer-only, and "show me the contracts I have
							 * out" is the most likely thing a rep wants from this chart.
							 */}
							<ul className="flex flex-col px-5 pb-1 md:px-6">
								{stageSlices.map((slice) => (
									<li key={slice.key} className="border-t first:border-t-0">
										<Link
											href={`/deals?stage=${slice.key}`}
											className="flex items-center gap-2.5 py-2 text-xs hover:underline"
										>
											<span
												aria-hidden
												className="size-1.5 shrink-0"
												style={{ backgroundColor: slice.color }}
											/>
											<span className="min-w-0 flex-1 truncate">
												{slice.label}
											</span>
											<span className="shrink-0 text-muted-foreground tabular-nums">
												{slice.count}
											</span>
											<span className="w-14 shrink-0 text-right font-medium tabular-nums">
												{formatMoneyCompact(slice.value)}
											</span>
										</Link>
									</li>
								))}
							</ul>
						</div>
					) : (
						<EmptyChart label="Nothing open" />
					)}
				</ChartPanel>
			</DashboardRow>

			{/*
			 * Forecast by close month — the Sage view reps rely on. Weighted is
			 * certainty × amount (`weightedAmount`); amount is the unweighted total.
			 */}
			<div
				className={
					showOwnerBreakdown
						? "grid gap-6 @3xl/page-content:grid-cols-2"
						: undefined
				}
			>
				<Card className="min-w-0">
					<CardHeader>
						<CardTitle>Forecast by close month</CardTitle>
						<CardDescription>
							Open deals by expected close — weighted vs unweighted
						</CardDescription>
					</CardHeader>
					{forecast.months.length === 0 ? (
						<EmptyChart label="Nothing open to forecast" />
					) : (
						<SimpleTable variant="panel" columns={monthColumns}>
							{forecast.months.map((month) => (
								<SimpleTableRow key={month.key}>
									<TableCell className={CELL}>
										<span className="flex min-w-0 items-center gap-2">
											<span className="truncate font-medium">
												{month.label}
											</span>
											{month.overdue ? (
												<span className="shrink-0 text-muted-foreground text-xs">
													Overdue
												</span>
											) : null}
										</span>
									</TableCell>
									<TableCell
										className={`${CELL} text-right text-muted-foreground tabular-nums`}
									>
										{month.dealCount}
									</TableCell>
									<TableCell className={`${CELL} text-right tabular-nums`}>
										{month.amountCents === 0 ? (
											<EmptyCellValue />
										) : (
											formatMoneyCompact(month.amountCents)
										)}
									</TableCell>
									<TableCell
										className={`${CELL} text-right font-medium tabular-nums`}
									>
										{month.weightedCents === 0 ? (
											<EmptyCellValue />
										) : (
											formatMoneyCompact(month.weightedCents)
										)}
									</TableCell>
								</SimpleTableRow>
							))}
						</SimpleTable>
					)}
				</Card>

				{showOwnerBreakdown ? (
					<Card className="min-w-0">
						<CardHeader>
							<CardTitle>Forecast by rep</CardTitle>
							<CardDescription>
								Open weighted pipeline across the team
							</CardDescription>
						</CardHeader>
						<SimpleTable variant="panel" columns={ownerColumns}>
							{forecast.byOwner.map((row) => (
								<SimpleTableRow key={row.owner.id}>
									<TableCell className={CELL}>
										<OwnerCell owner={row.owner} />
									</TableCell>
									<TableCell
										className={`${CELL} text-right text-muted-foreground tabular-nums`}
									>
										{row.dealCount}
									</TableCell>
									<TableCell className={`${CELL} text-right tabular-nums`}>
										{row.amountCents === 0 ? (
											<EmptyCellValue />
										) : (
											formatMoneyCompact(row.amountCents)
										)}
									</TableCell>
									<TableCell
										className={`${CELL} text-right font-medium tabular-nums`}
									>
										{row.weightedCents === 0 ? (
											<EmptyCellValue />
										) : (
											formatMoneyCompact(row.weightedCents)
										)}
									</TableCell>
								</SimpleTableRow>
							))}
						</SimpleTable>
					</Card>
				) : null}
			</div>
		</div>
	);
}

/**
 * A titled, framed plot, built from the same `Card` header the lists below the
 * charts use so every section on the page shares one heading rhythm.
 *
 * The body keeps a border where a list does not: a chart floating against the
 * page with no frame reads as unmoored, and `flex-1` makes both columns of a
 * row end level however tall their plots are.
 */
function ChartPanel({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children: ReactNode;
}) {
	return (
		<Card className="min-w-0">
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				{description ? <CardDescription>{description}</CardDescription> : null}
			</CardHeader>
			<div className="flex flex-1 flex-col border">{children}</div>
		</Card>
	);
}

function EmptyChart({ label }: { label: string }) {
	return (
		<div className="flex flex-1 items-center justify-center px-5 py-10 text-muted-foreground text-sm md:px-6">
			{label}
		</div>
	);
}
