"use client";

import { Button } from "@crm/ui/components/button";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
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
import { toast } from "sonner";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

type EnrollmentRow =
	RouterOutputs["sequences"]["enrollments"]["rows"][number];

type EnrollmentTableProps = {
	sequenceId: string;
};

export function EnrollmentTable({ sequenceId }: EnrollmentTableProps) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const openRecord = useOpenRecord();
	const list = useQuery(
		trpc.sequences.enrollments.queryOptions({ sequenceId }),
	);

	const invalidate = async () => {
		await queryClient.invalidateQueries({
			queryKey: trpc.sequences.enrollments.queryKey({ sequenceId }),
		});
		await queryClient.invalidateQueries({
			queryKey: trpc.sequences.byId.queryKey({ id: sequenceId }),
		});
		await queryClient.invalidateQueries({
			queryKey: trpc.sequences.list.queryKey(),
		});
	};

	const pause = useMutation(
		trpc.sequences.pauseEnrollment.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Enrollment paused.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const resume = useMutation(
		trpc.sequences.resumeEnrollment.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Enrollment resumed.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const stop = useMutation(
		trpc.sequences.stopEnrollment.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Enrollment stopped.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (list.isLoading) {
		return (
			<div className="flex items-center justify-center py-8">
				<Spinner />
			</div>
		);
	}

	const rows = list.data?.rows ?? [];
	if (rows.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">No enrollments yet.</p>
		);
	}

	return (
		<div className="min-h-0 overflow-auto rounded-md border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Contact</TableHead>
						<TableHead>Status</TableHead>
						<TableHead className="hidden md:table-cell">Step</TableHead>
						<TableHead className="hidden lg:table-cell">Next send</TableHead>
						<TableHead className="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((row) => (
						<EnrollmentRowView
							key={row.id}
							row={row}
							busy={
								pause.isPending || resume.isPending || stop.isPending
							}
							onOpen={() =>
								openRecord({ kind: "contact", id: row.contact.id })
							}
							onPause={() => pause.mutate({ id: row.id })}
							onResume={() => resume.mutate({ id: row.id })}
							onStop={() => stop.mutate({ id: row.id })}
						/>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

function EnrollmentRowView({
	row,
	busy,
	onOpen,
	onPause,
	onResume,
	onStop,
}: {
	row: EnrollmentRow;
	busy: boolean;
	onOpen: () => void;
	onPause: () => void;
	onResume: () => void;
	onStop: () => void;
}) {
	const name = [row.contact.firstName, row.contact.lastName]
		.filter(Boolean)
		.join(" ");
	const lastRun = row.runs[0];

	return (
		<TableRow>
			<TableCell>
				<button
					type="button"
					className="text-left font-medium hover:underline"
					onClick={onOpen}
				>
					{name}
				</button>
				<div className="text-muted-foreground text-xs">
					{row.contact.email ? row.contact.email : <EmptyCellValue />}
					{row.contact.company ? ` · ${row.contact.company.name}` : ""}
				</div>
				{lastRun?.openedAt || lastRun?.clickedAt ? (
					<div className="text-muted-foreground text-xs">
						{lastRun.openedAt ? "Opened" : null}
						{lastRun.openedAt && lastRun.clickedAt ? " · " : null}
						{lastRun.clickedAt ? "Clicked" : null}
					</div>
				) : null}
			</TableCell>
			<TableCell className="capitalize text-muted-foreground">
				{row.status.toLowerCase().replaceAll("_", " ")}
				{row.stoppedReason ? (
					<div className="text-xs">{row.stoppedReason}</div>
				) : null}
			</TableCell>
			<TableCell className="hidden md:table-cell">
				{row.currentStepOrder + 1}
			</TableCell>
			<TableCell className="hidden lg:table-cell text-muted-foreground">
				{row.status === "ACTIVE"
					? relativeTimeFromIso(
							typeof row.nextRunAt === "string"
								? row.nextRunAt
								: new Date(row.nextRunAt).toISOString(),
						)
					: "—"}
			</TableCell>
			<TableCell className="text-right">
				<div className="flex justify-end gap-1">
					{row.status === "ACTIVE" ? (
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={busy}
							onClick={onPause}
						>
							Pause
						</Button>
					) : null}
					{row.status === "PAUSED" ? (
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={busy}
							onClick={onResume}
						>
							Resume
						</Button>
					) : null}
					{row.status === "ACTIVE" || row.status === "PAUSED" ? (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							disabled={busy}
							onClick={onStop}
						>
							Stop
						</Button>
					) : null}
				</div>
			</TableCell>
		</TableRow>
	);
}
