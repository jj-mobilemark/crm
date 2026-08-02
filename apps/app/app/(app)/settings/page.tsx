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
import { GoogleConnection } from "./google-connection";
import { MicrosoftConnection } from "./microsoft-connection";

export const metadata: Metadata = {
	title: "Settings",
};

const microsoftEnabled = Boolean(
	process.env.MICROSOFT_CLIENT_ID &&
		process.env.MICROSOFT_CLIENT_SECRET &&
		process.env.MICROSOFT_TENANT_ID,
);
const googleEnabled = Boolean(
	process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);

export default async function SettingsPage() {
	await requireSession();

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();

	// Microsoft replaces Google as the real provider. Prefer that card when
	// Entra is configured; keep the Google card only when Google OAuth is on
	// and Microsoft is not (legacy / optional).
	if (microsoftEnabled) {
		// Awaited: the whole page is this one query, and rendering "Not connected"
		// for a beat before flipping to "Connected" is worse than waiting for it.
		await queryClient.prefetchQuery(trpc.microsoft.status.queryOptions());

		return (
			<PageShell>
				<PageShellHeader>
					<PageShellHeading>
						<PageShellTitle>Settings</PageShellTitle>
						<PageShellDescription>
							Your meetings and email, on the companies they belong to.
						</PageShellDescription>
					</PageShellHeading>
				</PageShellHeader>

				<PageShellContent>
					<HydrateClient>
						<MicrosoftConnection />
					</HydrateClient>
				</PageShellContent>
			</PageShell>
		);
	}

	if (!googleEnabled) {
		return (
			<PageShell>
				<PageShellHeader>
					<PageShellHeading>
						<PageShellTitle>Settings</PageShellTitle>
						<PageShellDescription>
							Your meetings and email, on the companies they belong to.
						</PageShellDescription>
					</PageShellHeading>
				</PageShellHeader>

				<PageShellContent>
					<p className="max-w-3xl text-muted-foreground text-sm/6">
						No mailbox provider is configured. Set the Microsoft Entra variables
						in `.env` to connect Outlook, or Google OAuth for Gmail.
					</p>
				</PageShellContent>
			</PageShell>
		);
	}

	await queryClient.prefetchQuery(trpc.google.status.queryOptions());

	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Settings</PageShellTitle>
					<PageShellDescription>
						Your meetings and email, on the companies they belong to.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent>
				<HydrateClient>
					<GoogleConnection />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
