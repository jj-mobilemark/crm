"use client";

import { Checkbox } from "@crm/ui/components/checkbox";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import {
	SimpleTable,
	type SimpleTableColumn,
	SimpleTableRow,
} from "@crm/ui/components/simple-table";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { TableCell } from "@crm/ui/components/table";
import { ToggleGroup, ToggleGroupItem } from "@crm/ui/components/toggle-group";
import { relativeTimeFromIso } from "@crm/ui/lib/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useQueryStates } from "nuqs";
import { toast } from "sonner";
import {
	PRIORITY_FACET_OPTIONS,
	PRIORITY_NONE,
	PRIORITY_OPTIONS,
	PriorityBadge,
	type PriorityValue,
} from "@/components/crm/priority";
import { RecordLink } from "@/components/crm/record-sheet/record-link";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { tasksParsers } from "./tasks-search-params";

type TaskRow = RouterOutputs["activities"]["myTasks"][number];

const CELL = "px-3 py-2.5 align-middle";

const COLUMNS: SimpleTableColumn[] = [
	{ srLabel: "Done", width: "w-8" },
	{ header: "Task" },
	{ header: "Priority", width: "w-36" },
	{ header: "Due", width: "w-28", align: "right" },
];

/**
 * The working list of the signed-in user's tasks.
 *
 * Filters live in the URL (status / due window / priority) so a shareable view
 * survives a refresh. Completing and re-prioritising stay on the row.
 */
export function TasksTable() {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const [params, setParams] = useQueryStates(tasksParsers);

	const tasks = useQuery({
		...trpc.activities.myTasks.queryOptions({
			status: params.status,
			window: params.window,
			priority: params.priority,
			limit: 100,
		}),
		placeholderData: (previous) => previous,
	});

	const complete = useMutation(
		trpc.activities.complete.mutationOptions({
			onSuccess: () => cache.activity(),
			onError: (error) => toast.error(error.message),
		}),
	);

	const setPriority = useMutation(
		trpc.activities.setPriority.mutationOptions({
			onSuccess: () => cache.activity(),
			onError: (error) => toast.error(error.message),
		}),
	);

	const rows = tasks.data ?? [];
	const now = Date.now();

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4">
			<div className="flex flex-wrap items-center gap-3">
				<ToggleGroup
					type="single"
					variant="outline"
					size="sm"
					spacing={0}
					value={params.status}
					onValueChange={(next) => {
						if (next) void setParams({ status: next as typeof params.status });
					}}
					aria-label="Task status"
				>
					<ToggleGroupItem value="open">Open</ToggleGroupItem>
					<ToggleGroupItem value="done">Done</ToggleGroupItem>
					<ToggleGroupItem value="all">All</ToggleGroupItem>
				</ToggleGroup>

				<ToggleGroup
					type="single"
					variant="outline"
					size="sm"
					spacing={0}
					value={params.window}
					onValueChange={(next) => {
						if (next) void setParams({ window: next as typeof params.window });
					}}
					aria-label="Due window"
				>
					<ToggleGroupItem value="all">Any due</ToggleGroupItem>
					<ToggleGroupItem value="overdue">Overdue</ToggleGroupItem>
					<ToggleGroupItem value="upcoming">Upcoming</ToggleGroupItem>
				</ToggleGroup>

				<Select
					value={params.priority}
					onValueChange={(next) =>
						void setParams({
							priority: next as typeof params.priority,
						})
					}
				>
					<SelectTrigger
						size="sm"
						aria-label="Priority filter"
						className="w-40"
					>
						<SelectValue placeholder="Priority" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All priorities</SelectItem>
						{PRIORITY_FACET_OPTIONS.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{rows.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					{params.status === "open"
						? "Nothing open. You are caught up."
						: "No tasks match this view."}
				</p>
			) : (
				<SimpleTable columns={COLUMNS}>
					{rows.map((task) => (
						<TaskRowView
							key={task.id}
							task={task}
							now={now}
							busy={complete.isPending || setPriority.isPending}
							onComplete={() =>
								complete.mutate({
									id: task.id,
									completed: task.completedAt === null,
								})
							}
							onPriority={(next) =>
								setPriority.mutate({
									id: task.id,
									priority:
										next === PRIORITY_NONE ? null : (next as PriorityValue),
								})
							}
						/>
					))}
				</SimpleTable>
			)}
		</div>
	);
}

function TaskRowView({
	task,
	now,
	busy,
	onComplete,
	onPriority,
}: {
	task: TaskRow;
	now: number;
	busy: boolean;
	onComplete: () => void;
	onPriority: (next: string) => void;
}) {
	const done = task.completedAt !== null;
	const overdue = Boolean(
		!done && task.dueAt && new Date(task.dueAt).getTime() < now,
	);

	return (
		<SimpleTableRow>
			<TableCell className={CELL}>
				<Checkbox
					checked={done}
					disabled={busy}
					aria-label={done ? "Mark as not done" : "Mark as done"}
					onCheckedChange={onComplete}
				/>
			</TableCell>
			<TableCell className={CELL}>
				<span className="flex min-w-0 flex-col">
					<span
						className={
							done ? "truncate text-muted-foreground line-through" : "truncate"
						}
					>
						{task.subject}
					</span>
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
			<TableCell className={CELL}>
				<Select
					value={task.priority ?? PRIORITY_NONE}
					onValueChange={onPriority}
					disabled={busy}
				>
					<SelectTrigger
						variant="ghost"
						size="sm"
						className="w-full"
						aria-label="Set priority"
					>
						<SelectValue>
							{task.priority ? (
								<PriorityBadge priority={task.priority} />
							) : (
								<span className="text-muted-foreground">No priority</span>
							)}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{PRIORITY_OPTIONS.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
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
}
