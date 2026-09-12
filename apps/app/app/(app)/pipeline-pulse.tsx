"use client";

import type { DealStage } from "@crm/db/enums";
import {
	Card,
	CardAction,
	CardDescription,
	CardHeader,
	CardPanel,
	CardPanelEmpty,
	CardTitle,
} from "@crm/ui/components/card";
import { CardTableEmpty } from "@crm/ui/components/card-table";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import {
	SimpleTable,
	type SimpleTableColumn,
	SimpleTableRow,
} from "@crm/ui/components/simple-table";
import { Spinner } from "@crm/ui/components/spinner";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { TableCell } from "@crm/ui/components/table";
import {
	formatMoneyCompact,
	formatPercent,
	relativeTimeFromIso,
} from "@crm/ui/lib/format";
import { useQuery } from "@tanstack/react-query";
import { useQueryStates } from "nuqs";
import { dealStageLabel } from "@/components/crm/deal-stage";
import { OwnerCell } from "@/components/crm/owner-cell";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import {
	overviewParsers,
	PULSE_CHANGE_FILTERS,
	PULSE_REP_ALL,
	type PulseChangeFilter,
	pulseFeedParsers,
} from "./overview-search-params";

type Summary = RouterOutputs["dashboard"]["summary"];
type Pulse = NonNullable<Summary["pulse"]>;
type PulseChange = Pulse["recent"][number];

const CELL = "px-3 py-2.5 align-middle";

const EMPTY_PULSE: Pulse = {
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

/**
 * Manager pulse tables: biggest movers, stuck deals, and the change feed.
 * KPI counts live in the sales dashboard strip (same `pulse` payload).
 */
export function PipelinePulse({ pulse }: { pulse: Pulse | undefined }) {
	const data = pulse ?? EMPTY_PULSE;
	const openRecord = useOpenRecord();
	const { movers, recent, stuck } = data;

	const moverColumns: SimpleTableColumn[] = [
		{ header: "Deal" },
		{ header: "Change", width: "w-44" },
		{ header: "Source", width: "w-20", className: "hidden sm:table-cell" },
		{ header: "When", width: "w-20", align: "right" },
	];

	const stuckColumns: SimpleTableColumn[] = [
		{ header: "Deal" },
		{ header: "Stage", width: "w-36", className: "hidden lg:table-cell" },
		{ header: "Rep", width: "w-32", className: "hidden md:table-cell" },
		{ header: "Stuck", width: "w-24", align: "right" },
	];

	return (
		<div className="flex flex-col gap-6">
			<div className="grid gap-6 @3xl/page-content:grid-cols-2">
				<Card className="min-w-0">
					<CardHeader>
						<CardTitle>Biggest movers</CardTitle>
						<CardDescription>
							Largest deal maturity, amount, and stage moves in the last{" "}
							{data.windowDays} days
						</CardDescription>
					</CardHeader>
					<CardPanel>
						{movers.length === 0 ? (
							<CardPanelEmpty>
								No deal field changes yet in this window. Edits in the app and
								Sage pulls will show here.
							</CardPanelEmpty>
						) : (
							<SimpleTable
								variant="panel"
								surface="page"
								columns={moverColumns}
							>
								{movers.map((change) => (
									<SimpleTableRow
										key={change.id}
										clickable
										onClick={() =>
											openRecord({ kind: "deal", id: change.deal.id })
										}
									>
										<TableCell className={CELL}>
											<DealLines
												name={change.deal.name}
												company={change.deal.company.name}
											/>
										</TableCell>
										<TableCell className={CELL}>
											<ChangeLines change={change} />
										</TableCell>
										<TableCell className={`${CELL} hidden sm:table-cell`}>
											<SourceBadge source={change.source} />
										</TableCell>
										<TableCell
											className={`${CELL} text-right text-muted-foreground`}
										>
											<span suppressHydrationWarning>
												{relativeTimeFromIso(change.createdAt)}
											</span>
										</TableCell>
									</SimpleTableRow>
								))}
							</SimpleTable>
						)}
					</CardPanel>
				</Card>

				<Card className="min-w-0">
					<CardHeader>
						<CardTitle>Stuck deals</CardTitle>
						<CardDescription>
							Open deals with no stage or deal maturity move in {data.stuckDays}
							+ days
						</CardDescription>
					</CardHeader>
					<CardPanel>
						{stuck.length === 0 ? (
							<CardPanelEmpty>
								Nothing stuck past {data.stuckDays} days. Good.
							</CardPanelEmpty>
						) : (
							<SimpleTable
								variant="panel"
								surface="page"
								columns={stuckColumns}
							>
								{stuck.map((deal) => (
									<SimpleTableRow
										key={deal.id}
										clickable
										onClick={() => openRecord({ kind: "deal", id: deal.id })}
									>
										<TableCell className={CELL}>
											<DealLines
												name={deal.name}
												company={deal.company.name}
												meta={
													deal.amountCents === null &&
													deal.weightedAmountCents === null
														? undefined
														: formatMoneyCompact(
																deal.amountCents ??
																	deal.weightedAmountCents ??
																	0,
																deal.currency,
															)
												}
											/>
										</TableCell>
										<TableCell className={`${CELL} hidden lg:table-cell`}>
											{dealStageLabel(deal.stage)}
										</TableCell>
										<TableCell className={`${CELL} hidden md:table-cell`}>
											<OwnerCell owner={deal.owner} />
										</TableCell>
										<TableCell className={`${CELL} text-right`}>
											<StatusIndicator
												tone="warning"
												label={`${deal.daysStuck}d`}
											/>
										</TableCell>
									</SimpleTableRow>
								))}
							</SimpleTable>
						)}
					</CardPanel>
				</Card>
			</div>

			<RecentDealMoves windowDays={data.windowDays} unfiltered={recent} />
		</div>
	);
}

const FEED_COLUMNS: SimpleTableColumn[] = [
	{ header: "Deal" },
	{ header: "Amount", width: "w-24", align: "right" },
	{ header: "Change", width: "w-48" },
	{ header: "Rep", width: "w-32", className: "hidden md:table-cell" },
	{ header: "Source", width: "w-20", className: "hidden sm:table-cell" },
	{ header: "When", width: "w-20", align: "right" },
];

/**
 * Full-width change feed. Filters live in the URL and hit the change log
 * when they are not "all", so a year-long range can still fill the table
 * with one rep or one change reason.
 */
function RecentDealMoves({
	windowDays,
	unfiltered,
}: {
	windowDays: number;
	unfiltered: PulseChange[];
}) {
	const openRecord = useOpenRecord();
	const trpc = useTRPC();
	const [overview] = useQueryStates(overviewParsers);
	const [filters, setFilters] = useQueryStates(pulseFeedParsers);
	const users = useQuery(trpc.users.list.queryOptions());

	const { scope, range, from, to } = overview;
	const effectiveRep = scope === "me" ? PULSE_REP_ALL : filters.pulseRep;
	const filtersOn =
		effectiveRep !== PULSE_REP_ALL || filters.pulseChange !== "all";

	const summaryInput = {
		scope,
		range,
		...(range === "custom" && from && to ? { from, to } : {}),
	};

	const filtered = useQuery({
		...trpc.dashboard.pulseRecent.queryOptions({
			...summaryInput,
			...(effectiveRep !== PULSE_REP_ALL ? { ownerId: effectiveRep } : {}),
			change: filters.pulseChange,
		}),
		enabled: filtersOn,
		placeholderData: (previous) => previous,
	});

	const recent = filtersOn ? (filtered.data?.recent ?? []) : unfiltered;
	const waiting = filtersOn && filtered.isPending && !filtered.data;
	const showEveryoneReps = scope === "everyone";

	return (
		<Card className="min-w-0">
			<CardHeader>
				<CardTitle>Recent deal moves</CardTitle>
				<CardDescription>
					Deal maturity, stage, amount, close date, owner, and priority — app
					and Sage, last {windowDays} days
				</CardDescription>
				<CardAction>
					{showEveryoneReps ? (
						<Select
							value={effectiveRep}
							onValueChange={(next) => {
								void setFilters({ pulseRep: next });
							}}
						>
							<SelectTrigger size="sm" aria-label="Filter by rep">
								<SelectValue placeholder="All reps" />
							</SelectTrigger>
							<SelectContent align="end">
								<SelectGroup>
									<SelectItem value={PULSE_REP_ALL}>All reps</SelectItem>
									{(users.data ?? []).map((user) => (
										<SelectItem key={user.id} value={user.id}>
											{user.name}
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
					) : null}
					<Select
						value={filters.pulseChange}
						onValueChange={(next) => {
							if (isPulseChangeFilter(next)) {
								void setFilters({ pulseChange: next });
							}
						}}
					>
						<SelectTrigger size="sm" aria-label="Filter by change">
							<SelectValue placeholder="All changes" />
						</SelectTrigger>
						<SelectContent align="end">
							<SelectGroup>
								{PULSE_CHANGE_FILTERS.map((value) => (
									<SelectItem key={value} value={value}>
										{changeFilterLabel(value)}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</CardAction>
			</CardHeader>
			{waiting ? (
				<div className="flex justify-center border-t py-10">
					<Spinner />
				</div>
			) : recent.length === 0 ? (
				<CardTableEmpty>
					{filtersOn
						? "No deal moves match these filters in this window."
						: "The change log starts when deals are edited here or updated from Sage. Older history is not backfilled."}
				</CardTableEmpty>
			) : (
				<SimpleTable columns={FEED_COLUMNS}>
					{recent.map((change) => (
						<SimpleTableRow
							key={change.id}
							clickable
							onClick={() => openRecord({ kind: "deal", id: change.deal.id })}
						>
							<TableCell className={CELL}>
								<DealLines
									name={change.deal.name}
									company={change.deal.company.name}
								/>
							</TableCell>
							<TableCell className={`${CELL} text-right tabular-nums`}>
								{change.deal.amountCents === null ||
								change.deal.amountCents === 0 ? (
									<EmptyCellValue />
								) : (
									formatMoneyCompact(
										change.deal.amountCents,
										change.deal.currency,
									)
								)}
							</TableCell>
							<TableCell className={CELL}>
								<ChangeLines change={change} />
							</TableCell>
							<TableCell className={`${CELL} hidden md:table-cell`}>
								<OwnerCell owner={change.deal.owner} />
							</TableCell>
							<TableCell className={`${CELL} hidden sm:table-cell`}>
								<SourceBadge source={change.source} />
							</TableCell>
							<TableCell className={`${CELL} text-right text-muted-foreground`}>
								<span suppressHydrationWarning>
									{relativeTimeFromIso(change.createdAt)}
								</span>
							</TableCell>
						</SimpleTableRow>
					))}
				</SimpleTable>
			)}
		</Card>
	);
}

function DealLines({
	name,
	company,
	meta,
}: {
	name: string;
	company: string;
	meta?: string;
}) {
	return (
		<span className="flex min-w-0 flex-col">
			<span className="truncate font-medium">{name}</span>
			<span className="truncate text-muted-foreground">
				{meta ? `${company} · ${meta}` : company}
			</span>
		</span>
	);
}

function ChangeLines({ change }: { change: PulseChange }) {
	return (
		<span className="flex min-w-0 flex-col">
			<span className="truncate">
				{fieldLabel(change.field, change.toValue)}
			</span>
			<span className="truncate text-muted-foreground">
				{formatTransition(change)}
			</span>
		</span>
	);
}

function SourceBadge({ source }: { source: "app" | "sage" }) {
	return (
		<StatusIndicator
			tone={source === "sage" ? "info" : "neutral"}
			label={source === "sage" ? "Sage" : "App"}
		/>
	);
}

function isPulseChangeFilter(value: string): value is PulseChangeFilter {
	return (PULSE_CHANGE_FILTERS as readonly string[]).includes(value);
}

function changeFilterLabel(filter: PulseChangeFilter): string {
	switch (filter) {
		case "all":
			return "All changes";
		case "won":
			return "Won";
		case "lost":
			return "Lost";
		case "stage":
			return "Stage";
		case "probability":
			return "Deal Maturity";
		case "amount":
			return "Amount";
		case "expectedCloseDate":
			return "Close date";
		case "ownerId":
			return "Owner";
		case "priority":
			return "Priority";
		case "sageStage":
			return "Sage stage";
	}
}

function fieldLabel(field: string, toValue: string | null): string {
	if (field === "stage") {
		if (toValue === "CLOSED_WON") return "Won";
		if (toValue === "CLOSED_LOST") return "Lost";
		return "Stage";
	}
	switch (field) {
		case "probability":
			return "Deal Maturity";
		case "amount":
			return "Amount";
		case "expectedCloseDate":
			return "Close date";
		case "ownerId":
			return "Owner";
		case "priority":
			return "Priority";
		case "sageStage":
			return "Sage stage";
		default:
			return field;
	}
}

function formatTransition(change: PulseChange): string {
	const from = formatFieldValue(
		change.field,
		change.fromValue,
		change.deal.currency,
	);
	const to = formatFieldValue(
		change.field,
		change.toValue,
		change.deal.currency,
	);
	if (change.field === "ownerId") {
		return "Owner reassigned";
	}
	if (from === "—" && to === "—") return "Changed";
	return `${from} → ${to}`;
}

function formatFieldValue(
	field: string,
	value: string | null,
	currency: string,
): string {
	if (value === null || value === "") return "—";
	switch (field) {
		case "stage":
			return dealStageLabel(value as DealStage);
		case "sageStage":
			return value;
		case "probability": {
			const n = Number(value);
			return Number.isFinite(n) ? formatPercent(n / 100) : value;
		}
		case "amount": {
			const dollars = Number(value);
			if (!Number.isFinite(dollars)) return value;
			return formatMoneyCompact(Math.round(dollars * 100), currency);
		}
		case "priority":
			return value;
		default:
			return value;
	}
}
