"use client";

import Checkmark from "@carbon/icons-react/es/Checkmark";
import Close from "@carbon/icons-react/es/Close";
import UserFollow from "@carbon/icons-react/es/UserFollow";
import { Button } from "@crm/ui/components/button";
import { Checkbox } from "@crm/ui/components/checkbox";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@crm/ui/components/empty";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { Icon } from "@crm/ui/components/icon";
import { Label } from "@crm/ui/components/label";
import { Spinner } from "@crm/ui/components/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@crm/ui/components/table";
import { relativeTimeFromIso } from "@crm/ui/lib/format";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

type PendingRow = RouterOutputs["screening"]["list"]["rows"][number];

function PendingActions({ row }: { row: PendingRow }) {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const openRecord = useOpenRecord();
	const queryClient = useQueryClient();
	const [suppressDomain, setSuppressDomain] = useState(false);
	const suppressId = useId();

	const invalidate = async () => {
		await queryClient.invalidateQueries({
			queryKey: trpc.screening.list.queryKey(),
		});
	};

	const decide = useMutation(
		trpc.screening.decide.mutationOptions({
			onSuccess: async (result) => {
				await invalidate();
				if (result.decision === "approve" && result.contactId) {
					await cache.contact(result.contactId);
					toast.success("Contact created.");
					openRecord({ kind: "contact", id: result.contactId });
					return;
				}
				toast.success(
					suppressDomain ? "Rejected — domain suppressed." : "Rejected.",
				);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const busy = decide.isPending;

	return (
		<span className="flex flex-col items-end gap-2">
			<span className="flex items-center gap-2">
				<Button
					size="sm"
					disabled={busy}
					onClick={() => decide.mutate({ id: row.id, decision: "approve" })}
				>
					<Icon icon={Checkmark} />
					Approve
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={busy}
					onClick={() =>
						decide.mutate({
							id: row.id,
							decision: "reject",
							suppressDomain,
						})
					}
				>
					<Icon icon={Close} />
					Reject
				</Button>
			</span>
			<span className="flex items-center gap-2">
				<Checkbox
					id={suppressId}
					checked={suppressDomain}
					onCheckedChange={(checked) => setSuppressDomain(checked === true)}
					disabled={busy}
				/>
				<Label htmlFor={suppressId} className="text-muted-foreground">
					Suppress {row.domain}
				</Label>
			</span>
		</span>
	);
}

export function ScreeningTable() {
	const trpc = useTRPC();
	const list = useQuery(trpc.screening.list.queryOptions());
	const rows = list.data?.rows ?? [];

	if (list.isLoading) {
		return (
			<div className="flex flex-1 items-center justify-center py-16">
				<Spinner />
			</div>
		);
	}

	if (rows.length === 0) {
		return (
			<Empty className="flex-1">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<Icon icon={UserFollow} />
					</EmptyMedia>
					<EmptyTitle>Nothing to review</EmptyTitle>
					<EmptyDescription>
						Unmatched external mail will show up here after sync.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	return (
		<div className="min-h-0 flex-1 overflow-auto">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Name</TableHead>
						<TableHead className="hidden md:table-cell">Email</TableHead>
						<TableHead className="hidden lg:table-cell">Domain</TableHead>
						<TableHead className="text-right">Messages</TableHead>
						<TableHead className="hidden md:table-cell">
							Sample subject
						</TableHead>
						<TableHead className="hidden text-right sm:table-cell">
							Last seen
						</TableHead>
						<TableHead className="text-right">
							<span className="sr-only">Actions</span>
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((row) => (
						<TableRow key={row.id}>
							<TableCell>
								{row.displayName ? (
									<span className="font-medium">{row.displayName}</span>
								) : (
									<span className="font-medium text-muted-foreground">
										{row.email}
									</span>
								)}
							</TableCell>
							<TableCell className="hidden text-muted-foreground md:table-cell">
								{row.email}
							</TableCell>
							<TableCell className="hidden lg:table-cell">
								{row.domain}
							</TableCell>
							<TableCell className="text-right">{row.messageCount}</TableCell>
							<TableCell className="hidden text-muted-foreground md:table-cell">
								{row.sampleSubject ? (
									<span className="truncate">{row.sampleSubject}</span>
								) : (
									<EmptyCellValue />
								)}
							</TableCell>
							<TableCell
								className="hidden text-right text-muted-foreground sm:table-cell"
								suppressHydrationWarning
							>
								{relativeTimeFromIso(row.lastSeenAt)}
							</TableCell>
							<TableCell className="text-right">
								<PendingActions row={row} />
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
