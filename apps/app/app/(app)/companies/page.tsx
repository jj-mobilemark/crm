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
import { companiesSearchParams } from "./companies-search-params";
import { CompaniesTable } from "./companies-table";
import { CreateCompanySheet } from "./create-company-sheet";

export const metadata: Metadata = {
	title: "Companies",
};

export default async function CompaniesPage({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	await requireSession();

	// Parsed with the same parsers the table uses, so the first paint is already
	// filtered, sorted and on the right page.
	const values = await companiesSearchParams.load(searchParams);

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	// The rows are awaited so the first paint is the filtered, sorted, correct
	// page rather than a spinner. The owner and company pickers behind the facet
	// dropdowns are not — the table draws fine without them.
	await queryClient.prefetchQuery(
		trpc.companies.list.queryOptions(companiesSearchParams.toInput(values)),
	);
	void queryClient.prefetchQuery(trpc.users.list.queryOptions());

	return (
		<PageShell className="min-h-0">
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Companies</PageShellTitle>
					<PageShellDescription>
						Every account in the pipeline.
					</PageShellDescription>
				</PageShellHeading>
				<PageShellActions>
					<ListSearch placeholder="Search companies by name or domain…" />
					<CreateCompanySheet />
				</PageShellActions>
			</PageShellHeader>

			<PageShellContent className="min-h-0">
				<HydrateClient>
					<CompaniesTable />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
