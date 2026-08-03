"use client";

import { Button } from "@crm/ui/components/button";
import { Spinner } from "@crm/ui/components/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@crm/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";
import { EnrollContacts } from "./enroll-contacts";
import { EnrollmentTable } from "./enrollment-table";

type SequenceDetailProps = {
	sequenceId: string;
	canSend: boolean;
};

export function SequenceDetail({ sequenceId, canSend }: SequenceDetailProps) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const detail = useQuery(trpc.sequences.byId.queryOptions({ id: sequenceId }));

	const invalidate = async () => {
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: trpc.sequences.byId.queryKey({ id: sequenceId }),
			}),
			queryClient.invalidateQueries({
				queryKey: trpc.sequences.list.queryKey(),
			}),
			queryClient.invalidateQueries({
				queryKey: trpc.sequences.enrollments.queryKey({ sequenceId }),
			}),
		]);
	};

	const update = useMutation(
		trpc.sequences.update.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Sequence updated.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (detail.isLoading || !detail.data) {
		return (
			<div className="flex flex-1 items-center justify-center py-16">
				<Spinner />
			</div>
		);
	}

	const sequence = detail.data;
	const isActive = sequence.status === "ACTIVE";
	const isArchived = sequence.status === "ARCHIVED";

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-8 overflow-auto pb-8">
			<header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex flex-col gap-1">
					<h2 className="font-semibold text-lg">{sequence.name}</h2>
					{sequence.description ? (
						<p className="text-muted-foreground text-sm">
							{sequence.description}
						</p>
					) : null}
					<p className="text-muted-foreground text-xs capitalize">
						{sequence.status.toLowerCase()} · {sequence.timezone} · window{" "}
						{formatMinute(sequence.sendWindowStartMinute)}–
						{formatMinute(sequence.sendWindowEndMinute)} · days{" "}
						{sequence.sendDays.join(",")}
					</p>
					<p className="text-muted-foreground text-xs">
						Stats: {sequence.stats.enrolled} enrolled · {sequence.stats.sent}{" "}
						sent · {sequence.stats.opened} opened · {sequence.stats.clicked}{" "}
						clicked · {sequence.stats.replied} replied
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					{!isActive && !isArchived ? (
						<Button
							type="button"
							size="sm"
							disabled={update.isPending}
							onClick={() =>
								update.mutate({
									id: sequenceId,
									data: { status: "ACTIVE" },
								})
							}
						>
							Activate
						</Button>
					) : null}
					{isActive ? (
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={update.isPending}
							onClick={() =>
								update.mutate({
									id: sequenceId,
									data: { status: "DRAFT" },
								})
							}
						>
							Pause sequence
						</Button>
					) : null}
					{!isArchived ? (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							disabled={update.isPending}
							onClick={() =>
								update.mutate({
									id: sequenceId,
									data: { status: "ARCHIVED" },
								})
							}
						>
							Archive
						</Button>
					) : null}
				</div>
			</header>

			<section className="flex flex-col gap-3">
				<h3 className="font-medium text-sm">Steps</h3>
				<div className="overflow-auto rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-16">#</TableHead>
								<TableHead>Subject</TableHead>
								<TableHead className="w-32">Delay</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{sequence.steps.map((step) => (
								<TableRow key={step.id}>
									<TableCell>{step.order + 1}</TableCell>
									<TableCell>{step.subject}</TableCell>
									<TableCell className="text-muted-foreground">
										{step.order === 0
											? "Immediate"
											: formatDelay(step.delayMinutes)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			</section>

			<section className="flex flex-col gap-3">
				<h3 className="font-medium text-sm">Enroll contacts</h3>
				{!isActive ? (
					<p className="text-muted-foreground text-sm">
						Activate the sequence before enrolling contacts.
					</p>
				) : !canSend ? (
					<p className="text-muted-foreground text-sm">
						Grant Outlook Mail.Send to enroll and send.
					</p>
				) : (
					<EnrollContacts sequenceId={sequenceId} onEnrolled={invalidate} />
				)}
			</section>

			<section className="flex min-h-0 flex-col gap-3">
				<h3 className="font-medium text-sm">Enrollments</h3>
				<EnrollmentTable sequenceId={sequenceId} />
			</section>
		</div>
	);
}

function formatMinute(minute: number): string {
	const h = Math.floor(minute / 60);
	const m = minute % 60;
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatDelay(minutes: number): string {
	if (minutes < 60) return `${minutes}m`;
	if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h`;
	return `${Math.round(minutes / (24 * 60))}d`;
}
