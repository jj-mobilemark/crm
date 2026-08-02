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
import { PriorityPrefs } from "./priority-prefs";
import { SuggestionsPanel } from "./suggestions-panel";

export const metadata: Metadata = {
	title: "Follow-ups",
};

export default async function FollowUpsPage() {
	await requireSession();

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();

	await Promise.all([
		queryClient.prefetchQuery(trpc.followups.prefs.queryOptions()),
		queryClient.prefetchQuery(trpc.followups.list.queryOptions()),
		queryClient.prefetchQuery(trpc.followups.pipeline.queryOptions()),
		queryClient.prefetchQuery(
			trpc.activities.myTasks.queryOptions({ window: "all", limit: 8 }),
		),
	]);

	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Follow-ups</PageShellTitle>
					<PageShellDescription>
						What the agent noticed in your synced mail, shaped by your
						priorities.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent>
				<HydrateClient>
					<PriorityPrefs />
					<SuggestionsPanel />
					<MyWorkPanels />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
