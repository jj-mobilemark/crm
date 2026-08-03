"use client";

import Add from "@carbon/icons-react/es/Add";
import ArrowLeft from "@carbon/icons-react/es/ArrowLeft";
import EmailNew from "@carbon/icons-react/es/EmailNew";
import { Button } from "@crm/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@crm/ui/components/empty";
import { Icon } from "@crm/ui/components/icon";
import { Spinner } from "@crm/ui/components/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@crm/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { SequenceDetail } from "./sequence-detail";
import { SequenceBuilder } from "./sequence-builder";

type SequenceRow = RouterOutputs["sequences"]["list"]["rows"][number];

type View =
	| { kind: "list" }
	| { kind: "create" }
	| { kind: "detail"; id: string };

export function SequencesPanel() {
	const trpc = useTRPC();
	const list = useQuery(trpc.sequences.list.queryOptions());
	const canSend = useQuery(trpc.sequences.canSend.queryOptions());
	const [view, setView] = useState<View>({ kind: "list" });

	if (view.kind === "create") {
		return (
			<div className="flex min-h-0 flex-1 flex-col gap-4">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="w-fit"
					onClick={() => setView({ kind: "list" })}
				>
					<Icon icon={ArrowLeft} />
					Back
				</Button>
				<SequenceBuilder
					onDone={(id) => setView({ kind: "detail", id })}
					onCancel={() => setView({ kind: "list" })}
				/>
			</div>
		);
	}

	if (view.kind === "detail") {
		return (
			<div className="flex min-h-0 flex-1 flex-col gap-4">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="w-fit"
					onClick={() => setView({ kind: "list" })}
				>
					<Icon icon={ArrowLeft} />
					Back
				</Button>
				<SequenceDetail
					sequenceId={view.id}
					canSend={canSend.data?.canSend ?? false}
				/>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4">
			{canSend.data && !canSend.data.canSend ? (
				<p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
					Outlook Mail.Send is not granted yet. You can build sequences, but
					enrolling contacts needs a Microsoft reconnect that includes send
					access (Entra must also grant admin consent for Mail.Send).
				</p>
			) : null}

			<div className="flex items-center justify-between gap-2">
				<p className="text-muted-foreground text-sm">
					{list.data?.rows.length ?? 0} sequence
					{(list.data?.rows.length ?? 0) === 1 ? "" : "s"}
				</p>
				<Button type="button" size="sm" onClick={() => setView({ kind: "create" })}>
					<Icon icon={Add} />
					New sequence
				</Button>
			</div>

			{list.isLoading ? (
				<div className="flex flex-1 items-center justify-center py-16">
					<Spinner />
				</div>
			) : (list.data?.rows.length ?? 0) === 0 ? (
				<Empty className="flex-1">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Icon icon={EmailNew} />
						</EmptyMedia>
						<EmptyTitle>No sequences yet</EmptyTitle>
						<EmptyDescription>
							Create a multi-step cadence, then enroll contacts to send from
							your Outlook mailbox.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="min-h-0 flex-1 overflow-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="hidden md:table-cell">Steps</TableHead>
								<TableHead className="hidden lg:table-cell">Enrolled</TableHead>
								<TableHead className="hidden lg:table-cell">Sent</TableHead>
								<TableHead className="hidden xl:table-cell">Replied</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{(list.data?.rows ?? []).map((row) => (
								<SequenceListRow
									key={row.id}
									row={row}
									onOpen={() => setView({ kind: "detail", id: row.id })}
								/>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</div>
	);
}

function SequenceListRow({
	row,
	onOpen,
}: {
	row: SequenceRow;
	onOpen: () => void;
}) {
	return (
		<TableRow
			className="cursor-pointer"
			onClick={onOpen}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onOpen();
				}
			}}
			tabIndex={0}
		>
			<TableCell className="font-medium">{row.name}</TableCell>
			<TableCell className="capitalize text-muted-foreground">
				{row.status.toLowerCase()}
			</TableCell>
			<TableCell className="hidden md:table-cell">{row._count.steps}</TableCell>
			<TableCell className="hidden lg:table-cell">
				{row.stats.enrolled}
			</TableCell>
			<TableCell className="hidden lg:table-cell">{row.stats.sent}</TableCell>
			<TableCell className="hidden xl:table-cell">
				{row.stats.replied}
			</TableCell>
		</TableRow>
	);
}
