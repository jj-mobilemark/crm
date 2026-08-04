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
import { TripPlannerClient } from "./trip-planner-client";

export const metadata: Metadata = {
	title: "Trip Planner",
};

export default async function TripPlannerPage() {
	await requireSession();

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	await queryClient.prefetchQuery(trpc.tripPlans.list.queryOptions());

	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Trip Planner</PageShellTitle>
					<PageShellDescription>
						Plan multi-day client visits from a hub city — brief the agent,
						build the itinerary, download a PDF.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent>
				<HydrateClient>
					<TripPlannerClient />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
