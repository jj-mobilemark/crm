"use client";

import { authClient } from "@crm/auth/client";
import { MS_ALL_SCOPES } from "@crm/auth/scopes";
import MicrosoftLogo from "@crm/ui/components/brand-logos/microsoft";
import { Button } from "@crm/ui/components/button";
import { Label } from "@crm/ui/components/label";
import { Spinner } from "@crm/ui/components/spinner";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { Switch } from "@crm/ui/components/switch";
import { relativeTimeFromIso } from "@crm/ui/lib/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
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
	const [reconnecting, setReconnecting] = useState(false);

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
			// Land on /grant-access so the rep can re-link immediately. Settings
			// alone used to leave them with no reconnect button.
			onSuccess: () => window.location.assign("/grant-access"),
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

	async function reconnect() {
		setReconnecting(true);
		const origin = window.location.origin;
		const { error } = await authClient.linkSocial({
			provider: "microsoft",
			scopes: [...MS_ALL_SCOPES],
			callbackURL: `${origin}/settings`,
			errorCallbackURL: `${origin}/settings`,
		});
		if (error) {
			toast.error(error.message ?? "Could not reach Microsoft.");
			setReconnecting(false);
		}
	}

	if (!status.data) return null;

	const { sources, hasRefreshToken } = status.data;

	const anyConnected = sources.some((source) => source.connected);
	const needsReconnect = !hasRefreshToken || !anyConnected;

	const broken = sources.find(
		(source) => source.status === "NEEDS_RECONNECT" || source.lastError,
	);
	const lastSyncedAt = sources
		.map((source) => source.lastSyncedAt)
		.filter((at): at is string => at !== null)
		.sort()
		.at(-1);

	const healthy = !broken && hasRefreshToken && anyConnected;

	return (
		<div className="flex max-w-3xl flex-col">
			<section className="flex flex-col gap-2 pb-5">
				<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
					<div className="flex items-center gap-3">
						<h2 className="font-medium text-sm">Microsoft 365</h2>
						<StatusIndicator
							tone={healthy ? "success" : "warning"}
							label={
								healthy
									? "Connected"
									: needsReconnect
										? "Not connected"
										: "Needs attention"
							}
						/>
					</div>

					{needsReconnect ? (
						<Button
							size="sm"
							disabled={reconnecting}
							onClick={() => {
								reconnect().catch(() =>
									toast.error("Could not start Microsoft reconnect."),
								);
							}}
						>
							{reconnecting ? (
								<Spinner data-icon="inline-start" />
							) : (
								<MicrosoftLogo data-icon="inline-start" className="size-4" />
							)}
							Reconnect Microsoft
						</Button>
					) : (
						<Button
							variant="outline"
							size="sm"
							disabled={syncNow.isPending}
							onClick={() => syncNow.mutate()}
						>
							{syncNow.isPending ? "Checking…" : "Check now"}
						</Button>
					)}
				</div>

				<p className="text-pretty text-muted-foreground text-sm/6">
					New meetings and email threads are added to the matching company as
					they happen. Nothing from before you connected is imported.
					Sequences can send from your Outlook mailbox when Mail.Send is
					granted.
				</p>

				<p className="text-muted-foreground text-xs">
					{needsReconnect
						? "Reconnect Microsoft to restore Outlook sync and sequence sending."
						: broken?.lastError
							? broken.lastError
							: lastSyncedAt
								? `Last checked ${relativeTimeFromIso(lastSyncedAt)}`
								: "Waiting for the first check"}
				</p>
			</section>

			{!needsReconnect ? (
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
										setAutoCreate.mutate({
											source: source.source,
											enabled,
										})
									}
								/>
							</div>
						);
					})}
				</section>
			) : null}

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

				{!needsReconnect ? (
					<button
						type="button"
						className="underline underline-offset-3 hover:text-foreground disabled:opacity-50"
						disabled={revoke.isPending}
						onClick={() => {
							if (
								!window.confirm(
									"Revoke Microsoft access? Outlook sync will stop until you reconnect.",
								)
							) {
								return;
							}
							revoke.mutate();
						}}
					>
						Revoke Microsoft access
					</button>
				) : null}

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
