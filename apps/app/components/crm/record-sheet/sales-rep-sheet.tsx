"use client";

import Building from "@carbon/icons-react/es/Building";
import ChartLine from "@carbon/icons-react/es/ChartLine";
import Partner from "@carbon/icons-react/es/Partnership";
import { Avatar, AvatarFallback, AvatarImage } from "@crm/ui/components/avatar";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { EntityLogo } from "@crm/ui/components/entity-logo";
import { SimpleTable, SimpleTableRow } from "@crm/ui/components/simple-table";
import { TableCell } from "@crm/ui/components/table";
import {
	formatCount,
	formatDay,
	formatMoney,
	formatMoneyCompact,
	formatPercent,
	initialsFromName,
	relativeTimeFromIso,
} from "@crm/ui/lib/format";
import { useQuery } from "@tanstack/react-query";
import { useQueryStates } from "nuqs";
import { overviewParsers } from "@/app/(app)/overview-search-params";
import {
	DealStageIndicator,
	dealStageCertainty,
	dealStageLabel,
} from "@/components/crm/deal-stage";
import {
	DetailSheetBody,
	DetailSheetEmpty,
	DetailSheetSection,
	DetailSheetStat,
	DetailSheetStats,
	type DetailSheetTab,
} from "@/components/detail-sheet";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { MetaLine, RecordSheetFrame } from "./record-parts";
import { useOpenRecord, useRecordSheetView } from "./record-stack";

type RepSummary = NonNullable<RouterOutputs["dashboard"]["repSummary"]>;

const DEAL_COLUMNS = [
	{ header: "Deal", width: "w-[32%]", className: "pl-5" },
	{ header: "Stage", width: "w-[18%]" },
	{ header: "Amount", width: "w-[14%]", align: "right" as const },
	{ header: "Deal Maturity", width: "w-[12%]", align: "right" as const },
	{ header: "Close", width: "w-[14%]" },
	{ header: "Moved", width: "w-[10%]" },
];

const COMPANY_COLUMNS = [
	{ header: "Company", className: "pl-5" },
	{ header: "Open deals", width: "w-28", align: "right" as const },
];

const ACTIVITY_COLUMNS = [
	{ header: "When", width: "w-[18%]", className: "pl-5" },
	{ header: "Deal", width: "w-[32%]" },
	{ header: "Field", width: "w-[18%]" },
	{ header: "Change", width: "w-[32%]" },
];

export function SalesRepSheet({ userId }: { userId: string }) {
	const trpc = useTRPC();
	const { tab, setTab } = useRecordSheetView("overview");
	const [params] = useQueryStates(overviewParsers);

	const query = useQuery(
		trpc.dashboard.repSummary.queryOptions({
			userId,
			range: params.range,
			from: params.from ?? undefined,
			to: params.to ?? undefined,
		}),
	);
	const summary = query.data;

	const tabs: DetailSheetTab[] = summary
		? [
				{
					value: "overview",
					label: "Overview",
					content: <RepOverview summary={summary} />,
				},
				{
					value: "deals",
					label: "Deals",
					count: summary.deals.length,
					content: <RepDeals summary={summary} />,
				},
				{
					value: "companies",
					label: "Companies",
					count: summary.companies.length,
					content: <RepCompanies summary={summary} />,
				},
				{
					value: "activity",
					label: "Activity",
					count: summary.recentChanges.length,
					content: <RepActivity summary={summary} />,
				},
			]
		: [];

	return (
		<RecordSheetFrame
			loading={query.isLoading}
			error={
				query.isError
					? query.error.message
					: query.isSuccess && !summary
						? "This user was not found"
						: null
			}
			media={
				summary ? (
					<Avatar size="lg">
						{summary.user.image ? (
							<AvatarImage src={summary.user.image} alt="" />
						) : null}
						<AvatarFallback>
							{initialsFromName(summary.user.name)}
						</AvatarFallback>
					</Avatar>
				) : undefined
			}
			title={summary?.user.name ?? "Sales rep"}
			description={
				summary ? <MetaLine parts={[summary.user.email]} /> : undefined
			}
			stats={
				summary ? (
					<DetailSheetStats>
						<DetailSheetStat label="Open pipeline">
							<span className="tabular-nums">
								{formatMoneyCompact(summary.kpis.openPipelineCents)}
							</span>
						</DetailSheetStat>
						<DetailSheetStat label="Weighted">
							<span className="tabular-nums">
								{formatMoneyCompact(summary.kpis.openWeightedCents)}
							</span>
						</DetailSheetStat>
						<DetailSheetStat label="Open deals">
							<span className="tabular-nums">
								{summary.kpis.openDealCount}
							</span>
						</DetailSheetStat>
						<DetailSheetStat label={`Win rate (${summary.range.windowDays}d)`}>
							<span className="tabular-nums">
								{summary.kpis.winRate === null
									? "—"
									: formatPercent(summary.kpis.winRate)}
							</span>
						</DetailSheetStat>
					</DetailSheetStats>
				) : undefined
			}
			tabs={tabs}
			tab={tab}
			onTabChange={setTab}
		/>
	);
}

function RepOverview({ summary }: { summary: RepSummary }) {
	const openRecord = useOpenRecord();
	const { kpis, certaintyBreakdown, certaintyMonths, stuck } = summary;

	return (
		<DetailSheetBody>
			<DetailSheetSection title="In range">
				<div className="grid grid-cols-2 gap-3 text-sm @md:grid-cols-4">
					<div>
						<p className="text-muted-foreground text-xs">Won</p>
						<p className="font-medium tabular-nums">
							{formatCount(kpis.wonCount, "deal")} ·{" "}
							{formatMoneyCompact(kpis.wonCents)}
						</p>
					</div>
					<div>
						<p className="text-muted-foreground text-xs">Lost</p>
						<p className="font-medium tabular-nums">{kpis.lostCount}</p>
					</div>
					<div>
						<p className="text-muted-foreground text-xs">Stuck</p>
						<p className="font-medium tabular-nums">{kpis.stuckCount}</p>
					</div>
					<div>
						<p className="text-muted-foreground text-xs">Closing this month</p>
						<p className="font-medium tabular-nums">
							{kpis.closingThisMonthCount}
						</p>
					</div>
				</div>
			</DetailSheetSection>

			<DetailSheetSection title="Deal Maturity by close month">
				<p className="mb-3 text-muted-foreground text-xs">
					Open deal amounts by stage for the current month and the next two
				</p>
				<div className="overflow-x-auto">
					<table className="w-full min-w-[28rem] border-collapse text-sm">
						<thead>
							<tr className="border-b text-left text-muted-foreground text-xs">
								<th className="py-2 pr-3 font-medium">Stage</th>
								{certaintyMonths.map((month) => (
									<th
										key={month.key}
										className="py-2 px-2 text-right font-medium"
									>
										{month.label}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{certaintyBreakdown.map((row) => (
								<tr key={row.stage} className="border-b last:border-b-0">
									<td className="py-2 pr-3">
										<span className="font-medium">
											{dealStageLabel(row.stage)}
										</span>
										<span className="ml-1.5 text-muted-foreground text-xs">
											({dealStageCertainty(row.stage)}%)
										</span>
									</td>
									{row.months.map((cell) => (
										<td
											key={cell.key}
											className="py-2 px-2 text-right tabular-nums"
										>
											{cell.amountCents === 0 ? (
												<span className="text-muted-foreground">—</span>
											) : (
												<span title={`${cell.dealCount} deal(s)`}>
													{formatMoneyCompact(cell.amountCents)}
												</span>
											)}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</DetailSheetSection>

			{stuck.length > 0 ? (
				<DetailSheetSection title="Stuck deals">
					<ul className="flex flex-col gap-1">
						{stuck.slice(0, 8).map((deal) => (
							<li key={deal.id}>
								<button
									type="button"
									className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-sm hover:bg-muted/60"
									onClick={() => openRecord({ kind: "deal", id: deal.id })}
								>
									<span className="min-w-0 flex-1 truncate font-medium">
										{deal.name}
									</span>
									<span className="shrink-0 text-muted-foreground text-xs">
										{deal.daysStuck}d · {deal.company.name}
									</span>
								</button>
							</li>
						))}
					</ul>
				</DetailSheetSection>
			) : null}
		</DetailSheetBody>
	);
}

function RepDeals({ summary }: { summary: RepSummary }) {
	const openRecord = useOpenRecord();

	if (summary.deals.length === 0) {
		return (
			<DetailSheetEmpty
				icon={ChartLine}
				title="No open deals"
				description="This rep has no open pipeline right now."
			/>
		);
	}

	return (
		<SimpleTable variant="panel" columns={DEAL_COLUMNS}>
			{summary.deals.map((deal) => (
				<SimpleTableRow
					key={deal.id}
					clickable
					onClick={() => openRecord({ kind: "deal", id: deal.id })}
				>
					<TableCell className="pl-5">
						<div className="flex min-w-0 items-center gap-2">
							<EntityLogo
								name={deal.company.name}
								src={deal.company.iconUrl}
								size="sm"
							/>
							<div className="min-w-0">
								<p className="truncate font-medium">{deal.name}</p>
								<p className="truncate text-muted-foreground text-xs">
									{deal.company.name}
								</p>
							</div>
						</div>
					</TableCell>
					<TableCell>
						<DealStageIndicator stage={deal.stage} />
					</TableCell>
					<TableCell className="text-right tabular-nums">
						{deal.amountCents === null ? (
							<EmptyCellValue />
						) : (
							formatMoney(deal.amountCents, deal.currency)
						)}
					</TableCell>
					<TableCell className="text-right tabular-nums">
						{deal.probability === null ? (
							<EmptyCellValue />
						) : (
							`${deal.probability}%`
						)}
					</TableCell>
					<TableCell>
						{deal.expectedCloseDate
							? formatDay(deal.expectedCloseDate)
							: <EmptyCellValue />}
					</TableCell>
					<TableCell className="text-muted-foreground text-xs">
						{relativeTimeFromIso(deal.stageChangedAt)}
					</TableCell>
				</SimpleTableRow>
			))}
		</SimpleTable>
	);
}

function RepCompanies({ summary }: { summary: RepSummary }) {
	const openRecord = useOpenRecord();

	if (summary.companies.length === 0) {
		return (
			<DetailSheetEmpty
				icon={Building}
				title="No owned companies"
				description="No companies list this rep as owner."
			/>
		);
	}

	return (
		<SimpleTable variant="panel" columns={COMPANY_COLUMNS}>
			{summary.companies.map((company) => (
				<SimpleTableRow
					key={company.id}
					clickable
					onClick={() => openRecord({ kind: "company", id: company.id })}
				>
					<TableCell className="pl-5">
						<div className="flex min-w-0 items-center gap-2">
							<EntityLogo
								name={company.name}
								src={company.iconUrl}
								size="sm"
							/>
							<span className="truncate font-medium">{company.name}</span>
						</div>
					</TableCell>
					<TableCell className="text-right tabular-nums">
						{company.openDealCount}
					</TableCell>
				</SimpleTableRow>
			))}
		</SimpleTable>
	);
}

function RepActivity({ summary }: { summary: RepSummary }) {
	const openRecord = useOpenRecord();

	if (summary.recentChanges.length === 0) {
		return (
			<DetailSheetEmpty
				icon={Partner}
				title="No deal moves in range"
				description={`Nothing changed on this rep's deals in ${summary.range.label.toLowerCase()}.`}
			/>
		);
	}

	return (
		<SimpleTable variant="panel" columns={ACTIVITY_COLUMNS}>
			{summary.recentChanges.map((change) => (
				<SimpleTableRow
					key={change.id}
					clickable
					onClick={() => openRecord({ kind: "deal", id: change.deal.id })}
				>
					<TableCell className="pl-5 text-muted-foreground text-xs">
						{relativeTimeFromIso(change.createdAt)}
					</TableCell>
					<TableCell>
						<div className="min-w-0">
							<p className="truncate font-medium">{change.deal.name}</p>
							<p className="truncate text-muted-foreground text-xs">
								{change.deal.company.name}
							</p>
						</div>
					</TableCell>
					<TableCell className="text-muted-foreground text-xs capitalize">
						{change.field === "probability" ? "Deal Maturity" : change.field}
					</TableCell>
					<TableCell className="text-xs tabular-nums">
						<span className="text-muted-foreground">
							{change.fromValue ?? "—"}
						</span>
						{" → "}
						<span className="font-medium">{change.toValue ?? "—"}</span>
					</TableCell>
				</SimpleTableRow>
			))}
		</SimpleTable>
	);
}
