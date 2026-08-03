import type { Metadata } from "next";
import type { SearchParams } from "nuqs/server";
import {
	PageShell,
	PageShellActions,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { CreateTaskSheet } from "./create-task-sheet";
import { parseTasksSearchParams, tasksQueryInput } from "./tasks-search-params";
import { TasksTable } from "./tasks-table";

export const metadata: Metadata = {
	title: "Tasks",
};

export default async function TasksPage({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	await requireSession();

	const values = await parseTasksSearchParams(searchParams);
	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();

	await queryClient.prefetchQuery(
		trpc.activities.myTasks.queryOptions(tasksQueryInput(values)),
	);

	return (
		<PageShell className="min-h-0">
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Tasks</PageShellTitle>
					<PageShellDescription>
						What you still have to do, ordered by priority and due date.
					</PageShellDescription>
				</PageShellHeading>
				<PageShellActions>
					<CreateTaskSheet />
				</PageShellActions>
			</PageShellHeader>

			<PageShellContent className="min-h-0">
				<HydrateClient>
					<TasksTable />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
