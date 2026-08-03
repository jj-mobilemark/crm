import type { SearchParams } from "nuqs/server";
import {
	PageShell,
	PageShellActions,
	PageShellContent,
	PageShellHeader,
	PageShellHeading,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { DashboardSummary } from "./dashboard-summary";
import { OverviewGreeting } from "./overview-greeting";
import { OverviewRangeControl } from "./overview-range";
import { OverviewScopeToggle } from "./overview-scope";
import { loadOverviewSearchParams } from "./overview-search-params";

export default async function OverviewPage({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	await requireSession();

	// Parsed with the same parsers the header controls use, so the first paint
	// already matches the URL rather than the defaults.
	const { scope, range, from, to } =
		await loadOverviewSearchParams(searchParams);

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();

	const summaryInput = {
		scope,
		range,
		...(range === "custom" && from && to ? { from, to } : {}),
	};

	// Both awaited: the greeting is one line of text and the dashboard is the
	// whole page, so a skeleton that flashes for the length of one API call is
	// worse than rendering a beat later.
	await Promise.all([
		queryClient.prefetchQuery(trpc.users.me.queryOptions()),
		queryClient.prefetchQuery(
			trpc.dashboard.summary.queryOptions(summaryInput),
		),
	]);

	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<HydrateClient>
						<OverviewGreeting />
					</HydrateClient>
				</PageShellHeading>
				<PageShellActions>
					<OverviewRangeControl />
					<OverviewScopeToggle />
				</PageShellActions>
			</PageShellHeader>

			<PageShellContent>
				<HydrateClient>
					<DashboardSummary />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
