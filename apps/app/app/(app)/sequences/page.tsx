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
import { SequencesPanel } from "./sequences-panel";

export const metadata: Metadata = {
	title: "Sequences",
};

export default async function SequencesPage() {
	await requireSession();

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	await Promise.all([
		queryClient.prefetchQuery(trpc.sequences.list.queryOptions()),
		queryClient.prefetchQuery(trpc.sequences.canSend.queryOptions()),
	]);

	return (
		<PageShell className="min-h-0">
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Sequences</PageShellTitle>
					<PageShellDescription>
						Multi-step email cadences sent from your Outlook mailbox.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent className="min-h-0">
				<HydrateClient>
					<SequencesPanel />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
