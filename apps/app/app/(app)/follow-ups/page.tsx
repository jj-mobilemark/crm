import type { Metadata } from "next";
import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { MyWorkPanels } from "./my-work-panels";
import { SuggestionsPanel } from "./suggestions-panel";

export const metadata: Metadata = {
	title: "Follow-ups",
};

export default async function FollowUpsPage() {
	const session = await requireSession();

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();

	await Promise.all([
		queryClient.prefetchQuery(trpc.followups.list.queryOptions()),
		queryClient.prefetchQuery(
			trpc.activities.myTasks.queryOptions({ window: "all", limit: 8 }),
		),
		queryClient.prefetchQuery(
			trpc.deals.list.queryOptions({
				owner: session.user.id,
				status: "open",
				pageSize: 8,
				sort: "lastActivity",
				dir: "asc",
			}),
		),
	]);

	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Follow-ups</PageShellTitle>
					<PageShellDescription>
						What the agent noticed in your synced mail, and what is on your
						plate.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent>
				<HydrateClient>
					<SuggestionsPanel />
					<MyWorkPanels userId={session.user.id} />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
