"use client";

import {
	DataTable,
	type DataTableColumn,
	type DataTableFacet,
} from "@crm/ui/components/data-table";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import {
	formatMoney,
	formatPercent,
	relativeTimeFromIso,
} from "@crm/ui/lib/format";
import { useQuery } from "@tanstack/react-query";
import { CLOSING_OPTIONS } from "@/components/crm/closing-window";
import { CompanyCell } from "@/components/crm/company-cell";
import { CompanyPicker } from "@/components/crm/company-picker";
import { DEAL_STAGE_OPTIONS } from "@/components/crm/deal-stage";
import { OwnedDealStageMenu } from "@/components/crm/owned-deal-stage-menu";
import { OwnerCell } from "@/components/crm/owner-cell";
import {
	PRIORITY_FACET_OPTIONS,
	PriorityBadge,
} from "@/components/crm/priority";
import { usePrefetchRecord } from "@/components/crm/record-sheet/record-prefetch";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { SageIdValue } from "@/components/crm/sage-id-value";
import { useTableQuery } from "@/components/data-table/use-table-query";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { dealsSearchParams } from "./deals-search-params";

type DealRow = RouterOutputs["deals"]["list"]["rows"][number];

const dateFormat = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	year: "numeric",
});

const COLUMNS: DataTableColumn<DealRow>[] = [
	{
		id: "name",
		header: "Deal",
		sortable: true,
		hideable: false,
		width: "w-[24%]",
		cell: (row) => <span className="truncate font-medium">{row.name}</span>,
	},
	{
		id: "company",
		header: "Company",
		sortable: true,
		width: "w-[18%]",
		cell: (row) => <CompanyCell company={row.company} />,
	},
	{
		id: "stage",
		header: "Stage",
		sortable: true,
		width: "w-[18%]",
		// Editable in place: moving a deal along is the single most common thing
		// anyone does here, and it should not need a page load.
		cell: (row) => (
			<OwnedDealStageMenu
				dealId={row.id}
				stage={row.stage}
				ownerId={row.owner.id}
			/>
		),
	},
	{
		id: "amount",
		header: "Amount",
		sortable: true,
		align: "right",
		width: "w-[12%]",
		hideBelow: "sm",
		cell: (row) =>
			row.amountCents === null ? (
				<EmptyCellValue />
			) : (
				<span className="tabular-nums">
					{formatMoney(row.amountCents, row.currency)}
				</span>
			),
	},
	{
		id: "weighted",
		header: "Weighted",
		label: "Weighted amount",
		align: "right",
		width: "w-[12%]",
		hideBelow: "md",
		cell: (row) =>
			row.weightedAmountCents === null ? (
				<EmptyCellValue />
			) : (
				<span className="tabular-nums">
					{formatMoney(row.weightedAmountCents, row.currency)}
				</span>
			),
	},
	{
		id: "probability",
		header: "Deal Maturity",
		align: "right",
		width: "w-[10%]",
		hideBelow: "lg",
		cell: (row) =>
			row.probability === null || row.probability === undefined ? (
				<EmptyCellValue />
			) : (
				<span className="tabular-nums text-muted-foreground">
					{formatPercent(row.probability / 100)}
				</span>
			),
	},
	{
		id: "priority",
		header: "Priority",
		width: "w-[12%]",
		hideBelow: "md",
		cell: (row) => <PriorityBadge priority={row.priority} />,
	},
	{
		id: "owner",
		header: "Owner",
		sortable: true,
		width: "w-[14%]",
		hideBelow: "md",
		cell: (row) => <OwnerCell owner={row.owner} />,
	},
	{
		id: "expectedCloseDate",
		header: "Close date",
		sortable: true,
		width: "w-[12%]",
		hideBelow: "lg",
		cell: (row) =>
			row.expectedCloseDate ? (
				<span className="text-muted-foreground">
					{dateFormat.format(new Date(row.expectedCloseDate))}
				</span>
			) : (
				<EmptyCellValue />
			),
	},
	{
		id: "dealType",
		header: "Type",
		label: "Deal type",
		width: "w-[12%]",
		defaultHidden: true,
		cell: (row) =>
			row.dealType ? (
				<span className="truncate text-muted-foreground">{row.dealType}</span>
			) : (
				<EmptyCellValue />
			),
	},
	{
		id: "sageCrmId",
		header: "Sage CRM",
		label: "Sage CRM ID",
		width: "w-[10%]",
		defaultHidden: true,
		cell: (row) => (
			<SageIdValue
				value={row.sageCrmOpportunityId}
				label="Sage CRM ID copied"
			/>
		),
	},
	{
		// Hidden by default, but present: it is the table's default sort, and a
		// default you cannot see or return to after sorting by something else is
		// just an unexplained row order.
		id: "createdAt",
		header: "Created",
		label: "Created date",
		sortable: true,
		align: "right",
		width: "w-[10%]",
		defaultHidden: true,
		cell: (row) => (
			<span className="text-muted-foreground" suppressHydrationWarning>
				{relativeTimeFromIso(row.createdAt)}
			</span>
		),
	},
	{
		id: "lastActivity",
		header: "Last activity",
		sortable: true,
		align: "right",
		width: "w-[12%]",
		hideBelow: "lg",
		defaultHidden: true,
		cell: (row) => (
			<span className="text-muted-foreground" suppressHydrationWarning>
				{relativeTimeFromIso(row.lastActivityAt)}
			</span>
		),
	},
];

export function DealsTable() {
	const openRecord = useOpenRecord();
	const trpc = useTRPC();
	const prefetchRecord = usePrefetchRecord();
	const { query, input } = useTableQuery(dealsSearchParams);
	const me = useQuery(trpc.users.me.queryOptions());

	// `"me"` is the URL default — resolve to the signed-in user before querying
	// so the first paint is already their pipeline.
	const ownerId =
		input.owner === "me" ? (me.data?.id ?? "all") : input.owner;
	const listInput = { ...input, owner: ownerId };

	const deals = useQuery({
		...trpc.deals.list.queryOptions(listInput),
		placeholderData: (previous) => previous,
		// Wait for `me` when the owner facet is still the sentinel, otherwise the
		// first request would be unfiltered and flash every deal.
		enabled: input.owner !== "me" || Boolean(me.data?.id),
	});
	const users = useQuery(trpc.users.list.queryOptions());

	const facetCounts = deals.data?.facetCounts;

	// Present `"me"` as the real user id so the Owner dropdown highlights them.
	const ownerFilter =
		query.filters.owner === "me" && me.data?.id
			? me.data.id
			: (query.filters.owner ?? "all");
	const tableQuery = {
		...query,
		filters: { ...query.filters, owner: ownerFilter },
	};

	const facets: DataTableFacet[] = [
		{
			id: "owner",
			label: "Owner",
			options: (users.data ?? [])
				.map((user) => ({ value: user.id, label: user.name }))
				.filter(
					(option) =>
						option.value === ownerFilter ||
						(facetCounts?.owner?.[option.value] ?? 0) > 0,
				),
		},
		{
			id: "company",
			label: "Company",
			options: [],
			render: ({ value, onChange, label }) => (
				<CompanyPicker
					allowAll
					allLabel={label}
					value={value}
					onChange={onChange}
					variant="filter"
				/>
			),
		},
		{
			id: "stage",
			label: "Stage",
			multiple: true,
			// Always list every stage (including zero-count) so Leads /
			// Unqualified stay visible after the Mobile Mark relabel.
			options: DEAL_STAGE_OPTIONS,
		},
		{
			id: "closing",
			label: "Closing",
			options: CLOSING_OPTIONS.filter(
				(option) => (facetCounts?.closing?.[option.value] ?? 0) > 0,
			).map((option) => ({ value: option.value, label: option.label })),
		},
		{
			id: "priority",
			label: "Priority",
			options: PRIORITY_FACET_OPTIONS.filter(
				(option) => (facetCounts?.priority?.[option.value] ?? 0) > 0,
			),
		},
	];

	const openValueCents = deals.data?.openValueCents;
	const openWeightedCents = deals.data?.openWeightedCents;

	return (
		<DataTable
			query={tableQuery}
			columns={COLUMNS}
			rows={deals.data?.rows ?? []}
			total={deals.data?.total ?? 0}
			facetCounts={facetCounts}
			facets={facets}
			tabs={{
				id: "status",
				allLabel: "All deals",
				options: [
					{ value: "open", label: "Open" },
					{ value: "closed", label: "Closed" },
				],
			}}
			getRowId={(row) => row.id}
			loading={deals.isFetching || (input.owner === "me" && !me.data)}
			onRowHover={(row) => prefetchRecord({ kind: "deal", id: row.id })}
			onRowClick={(row) => openRecord({ kind: "deal", id: row.id })}
			empty="No deals match this view."
			meta={
				// The open pipeline for everything the filters match, not just the
				// page — summed in Postgres.
				openValueCents === null || openValueCents === undefined ? undefined : (
					<span>
						{deals.data?.total ?? 0} deals ·{" "}
						<span className="tabular-nums">{formatMoney(openValueCents)}</span>{" "}
						open
						{openWeightedCents !== null && openWeightedCents !== undefined ? (
							<>
								{" "}
								·{" "}
								<span className="tabular-nums">
									{formatMoney(openWeightedCents)}
								</span>{" "}
								weighted
							</>
						) : null}
					</span>
				)
			}
		/>
	);
}
