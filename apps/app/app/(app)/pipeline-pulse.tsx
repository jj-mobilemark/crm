"use client";

import type { DealStage } from "@crm/db/enums";
import {
	Card,
	CardDescription,
	CardHeader,
	CardPanel,
	CardPanelEmpty,
	CardTitle,
} from "@crm/ui/components/card";
import { CardTableEmpty } from "@crm/ui/components/card-table";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import {
	SimpleTable,
	type SimpleTableColumn,
	SimpleTableRow,
} from "@crm/ui/components/simple-table";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { TableCell } from "@crm/ui/components/table";
import {
	formatMoneyCompact,
	formatPercent,
	relativeTimeFromIso,
} from "@crm/ui/lib/format";
import { dealStageLabel } from "@/components/crm/deal-stage";
import { OwnerCell } from "@/components/crm/owner-cell";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import type { RouterOutputs } from "@/lib/trpc/types";

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

	const feedColumns: SimpleTableColumn[] = [
		{ header: "Deal" },
		{ header: "Amount", width: "w-24", align: "right" },
		{ header: "Change", width: "w-48" },
		{ header: "Rep", width: "w-32", className: "hidden md:table-cell" },
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
							Open deals with no stage or deal maturity move in {data.stuckDays}+
							days
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

			<Card className="min-w-0">
				<CardHeader>
					<CardTitle>Recent deal moves</CardTitle>
					<CardDescription>
						Deal maturity, stage, amount, close date, owner, and priority — app
						and Sage, last {data.windowDays} days
					</CardDescription>
				</CardHeader>
				{recent.length === 0 ? (
					<CardTableEmpty>
						The change log starts when deals are edited here or updated from
						Sage. Older history is not backfilled.
					</CardTableEmpty>
				) : (
					<SimpleTable columns={feedColumns}>
						{recent.map((change) => (
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
								<TableCell
									className={`${CELL} text-right tabular-nums`}
								>
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
			</Card>
		</div>
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
			<span className="truncate">{fieldLabel(change.field, change.toValue)}</span>
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
