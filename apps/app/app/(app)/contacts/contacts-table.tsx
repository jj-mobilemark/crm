"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@crm/ui/components/avatar";
import {
	DataTable,
	type DataTableColumn,
	type DataTableFacet,
} from "@crm/ui/components/data-table";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { initialsFromName, relativeTimeFromIso } from "@crm/ui/lib/format";
import { useQuery } from "@tanstack/react-query";
import { CompanyCell } from "@/components/crm/company-cell";
import { CompanyPicker } from "@/components/crm/company-picker";
import { contactName } from "@/components/crm/contact-name";
import { OwnerCell } from "@/components/crm/owner-cell";
import { formatSage100Id } from "@/components/crm/sage-id";
import { SageIdValue } from "@/components/crm/sage-id-value";
import { usePrefetchRecord } from "@/components/crm/record-sheet/record-prefetch";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { useTableQuery } from "@/components/data-table/use-table-query";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { contactsSearchParams } from "./contacts-search-params";

type ContactRow = RouterOutputs["contacts"]["list"]["rows"][number];

const COLUMNS: DataTableColumn<ContactRow>[] = [
	{
		id: "name",
		header: "Name",
		sortable: true,
		hideable: false,
		width: "w-[22%]",
		cell: (row) => (
			<span className="flex min-w-0 items-center gap-2">
				<Avatar size="sm">
					{row.imageUrl ? <AvatarImage alt="" src={row.imageUrl} /> : null}
					<AvatarFallback>{initialsFromName(contactName(row))}</AvatarFallback>
				</Avatar>
				<span className="truncate font-medium">{contactName(row)}</span>
			</span>
		),
	},
	{
		id: "title",
		header: "Title",
		sortable: true,
		width: "w-[20%]",
		hideBelow: "lg",
		cell: (row) =>
			row.title ? (
				<span className="truncate">{row.title}</span>
			) : (
				<EmptyCellValue />
			),
	},
	{
		id: "email",
		header: "Email",
		sortable: true,
		width: "w-[24%]",
		hideBelow: "md",
		cell: (row) =>
			row.email ? (
				<span className="truncate text-muted-foreground">{row.email}</span>
			) : (
				<EmptyCellValue />
			),
	},
	{
		id: "company",
		header: "Company",
		sortable: true,
		width: "w-[18%]",
		cell: (row) => <CompanyCell company={row.company} />,
	},
	{
		id: "owner",
		header: "Owner",
		sortable: true,
		width: "w-[16%]",
		hideBelow: "md",
		defaultHidden: true,
		cell: (row) => <OwnerCell owner={row.owner} />,
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
		hideBelow: "sm",
		cell: (row) => (
			<span className="text-muted-foreground" suppressHydrationWarning>
				{relativeTimeFromIso(row.lastActivityAt)}
			</span>
		),
	},
	{
		id: "sageCrmId",
		header: "Sage CRM ID",
		defaultHidden: true,
		width: "w-[10%]",
		cell: (row) => (
			<SageIdValue value={row.sageCrmContactId} label="Sage CRM ID copied" />
		),
	},
	{
		id: "sage100Id",
		header: "Sage 100 ID",
		label: "Sage 100 ID (company)",
		width: "w-[12%]",
		cell: (row) => (
			<SageIdValue
				value={formatSage100Id(
					row.company?.sage100ArDivisionNo,
					row.company?.sage100CustomerNo,
				)}
				label="Sage 100 ID copied"
			/>
		),
	},
];

export function ContactsTable() {
	const openRecord = useOpenRecord();
	const trpc = useTRPC();
	const prefetchRecord = usePrefetchRecord();
	const { query, input } = useTableQuery(contactsSearchParams);

	const contacts = useQuery({
		...trpc.contacts.list.queryOptions(input),
		placeholderData: (previous) => previous,
	});
	const users = useQuery(trpc.users.list.queryOptions());

	const facetCounts = contacts.data?.facetCounts;

	const facets: DataTableFacet[] = [
		{
			id: "owner",
			label: "Owner",
			options: [
				{ value: "unassigned", label: "Unassigned" },
				...(users.data ?? []).map((user) => ({
					value: user.id,
					label: user.name,
				})),
			].filter((option) => (facetCounts?.owner?.[option.value] ?? 0) > 0),
		},
		{
			id: "company",
			label: "Company",
			// Options unused — searchable picker queries companies.options itself.
			options: [],
			render: ({ value, onChange, label }) => (
				<CompanyPicker
					allowAll
					allLabel={label}
					value={value}
					onChange={onChange}
					variant="filter"
					includeNone
					noneLabel="No company"
				/>
			),
		},
	];

	return (
		<DataTable
			query={query}
			columns={COLUMNS}
			rows={contacts.data?.rows ?? []}
			total={contacts.data?.total ?? 0}
			facetCounts={facetCounts}
			facets={facets}
			getRowId={(row) => row.id}
			loading={contacts.isFetching}
			onRowHover={(row) => prefetchRecord({ kind: "contact", id: row.id })}
			onRowClick={(row) => openRecord({ kind: "contact", id: row.id })}
			empty="No contacts match this view."
		/>
	);
}
