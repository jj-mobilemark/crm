"use client";

import {
	Card,
	CardDescription,
	CardHeader,
	CardPanel,
	CardPanelEmpty,
	CardTitle,
} from "@crm/ui/components/card";
import { Checkbox } from "@crm/ui/components/checkbox";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import {
	SimpleTable,
	type SimpleTableColumn,
	SimpleTableRow,
} from "@crm/ui/components/simple-table";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { TableCell } from "@crm/ui/components/table";
import { formatMoneyCompact, relativeTimeFromIso } from "@crm/ui/lib/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { DealStageIndicator } from "@/components/crm/deal-stage";
import { RecordLink } from "@/components/crm/record-sheet/record-link";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

const CELL = "px-3 py-2.5 align-middle";

const TASK_COLUMNS: SimpleTableColumn[] = [
	{ srLabel: "Done", width: "w-8" },
	{ header: "Task" },
	{ header: "Due", width: "w-24", align: "right" },
];

const DEAL_COLUMNS: SimpleTableColumn[] = [
	{ header: "Deal" },
	{ header: "Stage", width: "w-32", className: "hidden lg:table-cell" },
	{ header: "Value", width: "w-20", align: "right" },
];

/**
 * The other two lanes of the panel: what is already booked, and what is
 * already open — so a rep does not have to leave this page to see the whole
 * picture before deciding what to accept.
 */
export function MyWorkPanels() {
	return (
		<div className="grid gap-6 @3xl/page-content:grid-cols-2">
			<MyTasksPanel />
			<MyDealsPanel />
		</div>
	);
}

function MyTasksPanel() {
	const trpc = useTRPC();
	const cache = useCrmCache();

	const tasks = useQuery(
		trpc.activities.myTasks.queryOptions({ window: "all", limit: 8 }),
	);

	const complete = useMutation(
		trpc.activities.complete.mutationOptions({
			onSuccess: () => cache.activity(),
			onError: (error) => toast.error(error.message),
		}),
	);

	const rows = tasks.data ?? [];
	const now = Date.now();

	return (
		<Card className="min-w-0">
			<CardHeader>
				<CardTitle>My open tasks</CardTitle>
				<CardDescription>
					Everything you have logged that is not done.
				</CardDescription>
			</CardHeader>
			<CardPanel>
				{rows.length === 0 ? (
					<CardPanelEmpty>Nothing open. You are caught up.</CardPanelEmpty>
				) : (
					<SimpleTable variant="panel" surface="page" columns={TASK_COLUMNS}>
						{rows.map((task) => {
							const overdue = Boolean(
								task.dueAt && new Date(task.dueAt).getTime() < now,
							);

							return (
								<SimpleTableRow key={task.id}>
									<TableCell className={CELL}>
										<Checkbox
											checked={false}
											disabled={complete.isPending}
											aria-label="Mark as done"
											onCheckedChange={() =>
												complete.mutate({ id: task.id, completed: true })
											}
										/>
									</TableCell>
									<TableCell className={CELL}>
										<span className="flex min-w-0 flex-col">
											<span className="truncate">{task.subject}</span>
											<span className="flex min-w-0 text-muted-foreground">
												{task.deal ? (
													<RecordLink kind="deal" id={task.deal.id}>
														{task.deal.name}
													</RecordLink>
												) : task.company ? (
													<RecordLink kind="company" id={task.company.id}>
														{task.company.name}
													</RecordLink>
												) : task.contact ? (
													<RecordLink kind="contact" id={task.contact.id}>
														{[task.contact.firstName, task.contact.lastName]
															.filter(Boolean)
															.join(" ")}
													</RecordLink>
												) : null}
											</span>
										</span>
									</TableCell>
									<TableCell className={`${CELL} text-right`}>
										{task.dueAt ? (
											<StatusIndicator
												tone={overdue ? "error" : "neutral"}
												label={relativeTimeFromIso(task.dueAt)}
											/>
										) : (
											<EmptyCellValue />
										)}
									</TableCell>
								</SimpleTableRow>
							);
						})}
					</SimpleTable>
				)}
			</CardPanel>
		</Card>
	);
}

function MyDealsPanel() {
	const trpc = useTRPC();
	const openRecord = useOpenRecord();

	const pipeline = useQuery(trpc.followups.pipeline.queryOptions());
	const rows = pipeline.data?.rows ?? [];
	const scope = pipeline.data?.prefs.scope;

	return (
		<Card className="min-w-0">
			<CardHeader>
				<CardTitle>My active deals</CardTitle>
				<CardDescription>
					{scope === "mail"
						? "Secondary — your priorities are mail-driven."
						: scope === "shared"
							? "Deals you own or have worked."
							: "The quietest ones first."}
				</CardDescription>
			</CardHeader>
			<CardPanel>
				{rows.length === 0 ? (
					<CardPanelEmpty>No open deals right now.</CardPanelEmpty>
				) : (
					<SimpleTable variant="panel" surface="page" columns={DEAL_COLUMNS}>
						{rows.map((deal) => (
							<SimpleTableRow
								key={deal.id}
								clickable
								onClick={() => openRecord({ kind: "deal", id: deal.id })}
							>
								<TableCell className={CELL}>
									<span className="flex min-w-0 flex-col">
										<span className="truncate font-medium">{deal.name}</span>
										<span
											className="truncate text-muted-foreground"
											suppressHydrationWarning
										>
											{deal.company.name} ·{" "}
											{relativeTimeFromIso(deal.lastActivityAt)}
										</span>
									</span>
								</TableCell>
								<TableCell className={`${CELL} hidden lg:table-cell`}>
									<DealStageIndicator stage={deal.stage} />
								</TableCell>
								<TableCell className={`${CELL} text-right tabular-nums`}>
									{deal.amountCents === null ? (
										<EmptyCellValue />
									) : (
										formatMoneyCompact(deal.amountCents, deal.currency)
									)}
								</TableCell>
							</SimpleTableRow>
						))}
					</SimpleTable>
				)}
			</CardPanel>
		</Card>
	);
}
