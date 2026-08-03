import type { Metadata } from "next";
import type { SearchParams } from "nuqs/server";
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
import { MapPanel } from "./map-panel";
import { mapQueryInput, parseMapSearchParams } from "./map-search-params";

export const metadata: Metadata = {
	title: "Map",
};

export default async function MapPage({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	await requireSession();

	const values = await parseMapSearchParams(searchParams);
	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();

	await queryClient.prefetchQuery(
		trpc.companies.mapList.queryOptions(mapQueryInput(values)),
	);

	return (
		<PageShell className="min-h-0 max-w-none">
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Map</PageShellTitle>
					<PageShellDescription>
						Companies by city — filter by owner and Sage link.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent className="min-h-0">
				<HydrateClient>
					<MapPanel />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
