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
import { ScreeningTable } from "./screening-table";

export const metadata: Metadata = {
	title: "Screening",
};

export default async function ScreeningPage() {
	await requireSession();

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	await queryClient.prefetchQuery(trpc.screening.list.queryOptions());

	return (
		<PageShell className="min-h-0">
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Screening</PageShellTitle>
					<PageShellDescription>
						People from synced mail and website form leads who are not in the
						CRM yet.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent className="min-h-0">
				<HydrateClient>
					<ScreeningTable />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
