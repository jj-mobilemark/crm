"use client";

import Launch from "@carbon/icons-react/es/Launch";
import Warning from "@carbon/icons-react/es/Warning";
import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@crm/ui/components/alert";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import { Label } from "@crm/ui/components/label";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { Switch } from "@crm/ui/components/switch";
import { relativeTimeFromIso } from "@crm/ui/lib/format";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
	calendar: {
		label: "Meetings",
		autoCreate: "Add the company and contact when you meet someone new",
	},
	gmail: {
		label: "Email",
		autoCreate: "Add the company and contact when you reply to someone new",
	},
} as const;

/**
 * Where a "Resolve" link is allowed to point.
 *
 * The URL is scraped out of a vendor error string with a regex, and the string
 * reaches us through a sync that talks to a third party. Rendering whatever it
 * contains as a link a rep will click is a phishing hop waiting to happen, so
 * the destination has to be somewhere the fix could actually live.
 */
const RESOLVE_HOSTS = [
	"console.cloud.google.com",
	"console.developers.google.com",
	"support.google.com",
	"myaccount.google.com",
];

function resolveLink(error: string): string | undefined {
	const found = error.match(/https?:\/\/[^\s)]+/)?.[0];
	if (!found) return undefined;

	try {
		const url = new URL(found);
		const allowed =
			url.protocol === "https:" &&
			RESOLVE_HOSTS.some(
				(host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
			);
		return allowed ? url.toString() : undefined;
	} catch {
		return undefined;
	}
}

function explain(error: string) {
	return {
		summary: error.split(/(?<=\.)\s/)[0] ?? error,
		url: resolveLink(error),
	};
}

/**
 * What is currently wrong, as one comparable string.
 *
 * Keyed by source *and* message so that a check which fixes Gmail and leaves
 * Calendar broken is a different state, not the same one — otherwise half a
 * repair would be reported as no progress at all.
 */
function failureSignature(
	sources: readonly {
		source: string;
		status: string | null;
		lastError: string | null;
	}[],
): string {
	return sources
		.filter((source) => source.status === "NEEDS_RECONNECT" || source.lastError)
		.map((source) => `${source.source}:${source.lastError ?? "reconnect"}`)
		.sort()
		.join("|");
}

export function GoogleConnection() {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const queryClient = useQueryClient();

	const status = useQuery({
		...trpc.google.status.queryOptions(),
		// A sync is background work no client action caused, so per the API rules
		// it is polled, not invalidated — and the poll stops the moment it settles.
		refetchInterval: (query) =>
			query.state.data?.sources.some((source) => isSyncing(source.status))
				? SYNC_POLL_MS
				: false,
	});

	const purge = useMutation(
		trpc.google.purgeSyncedData.mutationOptions({
			onSuccess: async (result) => {
				await cache.google();
				toast.success(`Removed ${result.purged} synced items.`);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const revoke = useMutation(
		trpc.google.revokeAccess.mutationOptions({
			// A full navigation, not a router push: the grant is gone, so every
			// cached render is wrong and the gate has to re-evaluate. Lands on
			// /grant-access.
			onSuccess: () => window.location.assign("/"),
			onError: (error) => toast.error(error.message),
		}),
	);

	const setAutoCreate = useMutation(
		trpc.google.setAutoCreate.mutationOptions({
			onSuccess: () => cache.google({ settle: "record" }),
			onError: (error) => toast.error(error.message),
		}),
	);

	/*
	 * A check that lands on the same failure changes nothing on screen, so the
	 * button looks broken rather than the connection. Incrementing this replays
	 * the alert's attention animation — the page answering "still here" instead
	 * of appearing not to have run.
	 */
	const [insistence, setInsistence] = useState(0);

	const syncNow = useMutation(
		trpc.google.syncNow.mutationOptions({
			onSuccess: async () => {
				const before = failureSignature(status.data?.sources ?? []);
				await cache.google();

				// Read the refetched value rather than `status.data`, which is the
				// render's snapshot and is still the pre-check one inside here.
				const after = failureSignature(
					queryClient.getQueryData(trpc.google.status.queryKey())?.sources ??
						[],
				);

				if (after && after === before) setInsistence((count) => count + 1);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (!status.data) return null;

	const { sources, hasRefreshToken } = status.data;

	// Both scopes come from one grant at sign-in, so "Gmail connected but
	// Calendar not" is not a state that exists. One section, not one per source.
	const failing = sources.filter(
		(source) => source.status === "NEEDS_RECONNECT" || source.lastError,
	);
	const lastSyncedAt = sources
		.map((source) => source.lastSyncedAt)
		.filter((at): at is string => at !== null)
		.sort()
		.at(-1);

	const healthy = failing.length === 0 && hasRefreshToken;

	return (
		// No card: the page shell already owns the gutter, so a padded container
		// here would indent every line away from the heading above it — and there
		// is no border or fill to earn that indent. Sections separated by rules,
		// like the record sheets.
		<div className="flex max-w-3xl flex-col">
			<section className="flex flex-col gap-2 pb-5">
				<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
					<div className="flex items-center gap-3">
						<h2 className="font-medium text-sm">Google</h2>
						<StatusIndicator
							tone={healthy ? "success" : "warning"}
							label={healthy ? "Connected" : "Needs attention"}
						/>
					</div>

					<Button
						variant="contrast"
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

				{!hasRefreshToken ? (
					<Alert variant="destructive" attention={insistence}>
						<Icon icon={Warning} />
						<AlertTitle>Google did not return a refresh token</AlertTitle>
						<AlertDescription>Sign out and back in.</AlertDescription>
					</Alert>
				) : failing.length > 0 ? (
					failing.map((source) => {
						const { summary, url } = explain(
							source.lastError ?? "Google needs reconnecting.",
						);

						return (
							<Alert
								key={source.source}
								variant="destructive"
								attention={insistence}
							>
								<Icon icon={Warning} />
								<AlertTitle>
									{SOURCES[source.source].label} sync failed
								</AlertTitle>
								<AlertDescription>{summary}</AlertDescription>

								{url ? (
									<AlertAction>
										{/*
										 * The inverted chip, not the primary fill. Green
										 * means "the action you want" everywhere else, and
										 * inside a failure panel it reads as reassurance.
										 * On the alert's grey this is the loudest thing in
										 * the box, which is what the one way out should be.
										 */}
										<Button variant="contrast" size="xs" asChild>
											<a href={url} target="_blank" rel="noreferrer">
												Resolve
												<Icon icon={Launch} data-icon="inline-end" />
											</a>
										</Button>
									</AlertAction>
								) : null}
							</Alert>
						);
					})
				) : (
					<p className="text-muted-foreground text-xs">
						{lastSyncedAt
							? `Last checked ${relativeTimeFromIso(lastSyncedAt)}`
							: "Waiting for the first check"}
					</p>
				)}
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
								htmlFor={`auto-create-${source.source}`}
								className="flex flex-col items-start gap-1"
							>
								<span className="text-sm">{copy.label}</span>
								<span className="font-normal text-muted-foreground text-xs">
									{copy.autoCreate}
								</span>
							</Label>

							<Switch
								id={`auto-create-${source.source}`}
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

			{/*
			 * Quiet by design. These are the irreversible actions and neither is
			 * anybody's daily business, so they sit at the bottom in muted type
			 * rather than as a third block competing for attention.
			 */}
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
						// Worth a confirm: one OAuth client means one grant, so this ends
						// CRM access entirely, not just syncing.
						if (
							!window.confirm(
								"Revoke Google access? You will be signed out and cannot use the CRM until you grant it again.",
							)
						) {
							return;
						}
						revoke.mutate();
					}}
				>
					Revoke Google access
				</button>

				<a
					href="https://myaccount.google.com/permissions"
					target="_blank"
					rel="noreferrer"
					className="underline underline-offset-3 hover:text-foreground"
				>
					Manage in your Google account
				</a>
			</div>
		</div>
	);
}
