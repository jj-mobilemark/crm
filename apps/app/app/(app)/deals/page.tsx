import type { Metadata } from "next";
import type { SearchParams } from "nuqs/server";
import { ListSearch } from "@/components/data-table/list-search";
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
import { CreateDealSheet } from "./create-deal-sheet";
import { dealsSearchParams } from "./deals-search-params";
import { DealsTable } from "./deals-table";

export const metadata: Metadata = {
	title: "Deals",
};

export default async function DealsPage({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	const session = await requireSession();

	const values = await dealsSearchParams.load(searchParams);
	const input = dealsSearchParams.toInput(values);
	// Match the client: `"me"` → the signed-in user so SSR prefetch is already
	// scoped to their deals.
	if (input.owner === "me") {
		input.owner = session.user.id;
	}

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	// The rows are awaited so the first paint is the filtered, sorted, correct
	// page rather than a spinner. The owner and company pickers behind the facet
	// dropdowns are not — the table draws fine without them.
	await queryClient.prefetchQuery(trpc.deals.list.queryOptions(input));
	void queryClient.prefetchQuery(trpc.users.list.queryOptions());
	void queryClient.prefetchQuery(trpc.users.me.queryOptions());
	void queryClient.prefetchQuery(
		trpc.companies.options.queryOptions({ q: "" }),
	);

	return (
		<PageShell className="min-h-0">
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Deals</PageShellTitle>
					<PageShellDescription>
						The pipeline, and everything that has already closed.
					</PageShellDescription>
				</PageShellHeading>
				<PageShellActions>
					<ListSearch placeholder="Search deals by name or company…" />
					<CreateDealSheet />
				</PageShellActions>
			</PageShellHeader>

			<PageShellContent className="min-h-0">
				<HydrateClient>
					<DealsTable />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
