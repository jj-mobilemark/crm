"use client";

import { Button } from "@crm/ui/components/button";
import { Label } from "@crm/ui/components/label";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { Switch } from "@crm/ui/components/switch";
import { relativeTimeFromIso } from "@crm/ui/lib/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { isSyncing, SYNC_POLL_MS } from "@/components/crm/sync-status";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

/**
 * What each source contributes, in the rep's terms.
 *
 * The toggle copy says what a record *becoming* real depends on, because that
 * is the only decision on this page with a consequence.
 */
const SOURCES = {
	"outlook-calendar": {
		label: "Meetings",
		autoCreate: "Add the company and contact when you meet someone new",
	},
	outlook: {
		label: "Email",
		autoCreate: "Add the company and contact when you reply to someone new",
	},
} as const;

export function MicrosoftConnection() {
	const trpc = useTRPC();
	const cache = useCrmCache();

	const status = useQuery({
		...trpc.microsoft.status.queryOptions(),
		// A sync is background work no client action caused, so per the API rules
		// it is polled, not invalidated — and the poll stops the moment it settles.
		refetchInterval: (query) =>
			query.state.data?.sources.some((source) => isSyncing(source.status))
				? SYNC_POLL_MS
				: false,
	});

	const purge = useMutation(
		trpc.microsoft.purgeSyncedData.mutationOptions({
			onSuccess: async (result) => {
				await cache.microsoft();
				toast.success(`Removed ${result.purged} synced items.`);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const revoke = useMutation(
		trpc.microsoft.revokeAccess.mutationOptions({
			// A full navigation, not a router push: the tokens are gone, so every
			// cached render is wrong and the gate has to re-evaluate.
			onSuccess: () => window.location.assign("/"),
			onError: (error) => toast.error(error.message),
		}),
	);

	const setAutoCreate = useMutation(
		trpc.microsoft.setAutoCreate.mutationOptions({
			onSuccess: () => cache.microsoft({ settle: "record" }),
			onError: (error) => toast.error(error.message),
		}),
	);

	const syncNow = useMutation(
		trpc.microsoft.syncNow.mutationOptions({
			onSuccess: () => cache.microsoft(),
			onError: (error) => toast.error(error.message),
		}),
	);

	if (!status.data) return null;

	const { sources, hasRefreshToken } = status.data;

	const broken = sources.find(
		(source) => source.status === "NEEDS_RECONNECT" || source.lastError,
	);
	const lastSyncedAt = sources
		.map((source) => source.lastSyncedAt)
		.filter((at): at is string => at !== null)
		.sort()
		.at(-1);

	const healthy = !broken && hasRefreshToken;

	return (
		<div className="flex max-w-3xl flex-col">
			<section className="flex flex-col gap-2 pb-5">
				<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
					<div className="flex items-center gap-3">
						<h2 className="font-medium text-sm">Microsoft 365</h2>
						<StatusIndicator
							tone={healthy ? "success" : "warning"}
							label={healthy ? "Connected" : "Needs attention"}
						/>
					</div>

					<Button
						variant="outline"
						size="sm"
						disabled={syncNow.isPending}
						onClick={() => syncNow.mutate()}
					>
						{syncNow.isPending ? "Checking…" : "Check now"}
					</Button>
				</div>

				<p className="text-pretty text-muted-foreground text-sm/6">
					New meetings and email threads are added to the matching company as
					they happen. Nothing from before you connected is imported, and
					nothing is ever sent on your behalf.
				</p>

				<p className="text-muted-foreground text-xs">
					{!hasRefreshToken
						? "Sign out and back in to finish setting up — Microsoft did not return a refresh token."
						: broken?.lastError
							? broken.lastError
							: lastSyncedAt
								? `Last checked ${relativeTimeFromIso(lastSyncedAt)}`
								: "Waiting for the first check"}
				</p>
			</section>

			<section className="flex flex-col gap-5 border-t py-5">
				{sources.map((source) => {
					const copy = SOURCES[source.source];

					return (
						<div
							key={source.source}
							className="flex items-center justify-between gap-6"
						>
							<Label
								htmlFor={`ms-auto-create-${source.source}`}
								className="flex flex-col items-start gap-1"
							>
								<span className="text-sm">{copy.label}</span>
								<span className="font-normal text-muted-foreground text-xs">
									{copy.autoCreate}
								</span>
							</Label>

							<Switch
								id={`ms-auto-create-${source.source}`}
								checked={source.autoCreate}
								disabled={setAutoCreate.isPending}
								onCheckedChange={(enabled) =>
									setAutoCreate.mutate({ source: source.source, enabled })
								}
							/>
						</div>
					);
				})}
			</section>

			<div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-5 text-muted-foreground text-xs">
				<button
					type="button"
					className="underline underline-offset-3 hover:text-foreground disabled:opacity-50"
					disabled={purge.isPending}
					onClick={() => {
						if (
							!window.confirm(
								"Delete every synced email and meeting from the CRM?",
							)
						) {
							return;
						}
						purge.mutate();
					}}
				>
					Delete synced data
				</button>

				<button
					type="button"
					className="underline underline-offset-3 hover:text-foreground disabled:opacity-50"
					disabled={revoke.isPending}
					onClick={() => {
						if (
							!window.confirm(
								"Revoke Microsoft access? Outlook sync will stop until you sign in with Microsoft again.",
							)
						) {
							return;
						}
						revoke.mutate();
					}}
				>
					Revoke Microsoft access
				</button>

				<a
					href="https://account.microsoft.com/privacy"
					target="_blank"
					rel="noreferrer"
					className="underline underline-offset-3 hover:text-foreground"
				>
					Manage in your Microsoft account
				</a>
			</div>
		</div>
	);
}
