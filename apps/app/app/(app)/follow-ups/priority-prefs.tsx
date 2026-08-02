"use client";

import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { Field, FieldGroup, FieldLabel } from "@crm/ui/components/field";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { Spinner } from "@crm/ui/components/spinner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

type Prefs = RouterOutputs["followups"]["prefs"];

const DEFAULT_PREFS: Prefs = {
	floatFirst: "balanced",
	lookback: "30d",
	scope: "owned",
};

const FLOAT_OPTIONS = [
	{ value: "balanced", label: "Balanced mix" },
	{ value: "commitments", label: "Commitments I made" },
	{ value: "replies", label: "Replies I owe" },
	{ value: "deal-risk", label: "At-risk / stale deals" },
] as const;

const LOOKBACK_OPTIONS = [
	{ value: "7d", label: "Last 7 days" },
	{ value: "30d", label: "Last 30 days" },
	{ value: "90d", label: "Last 90 days" },
] as const;

const SCOPE_OPTIONS = [
	{ value: "owned", label: "My owned deals + my mail" },
	{ value: "shared", label: "Include deals I am on" },
	{ value: "mail", label: "Mail-driven only" },
] as const;

/**
 * Three fixed selects that reshape what this page calls out. Filters only —
 * no open chat. Changing one persists and refreshes the suggestion + deals
 * lanes.
 */
export function PriorityPrefs() {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const prefs = useQuery(trpc.followups.prefs.queryOptions());

	const update = useMutation(
		trpc.followups.updatePrefs.mutationOptions({
			onSuccess: async () => {
				await cache.followup();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const value = prefs.data ?? (prefs.isError ? DEFAULT_PREFS : null);
	const busy = update.isPending || prefs.isLoading;

	function patch(next: Partial<Prefs>) {
		const base = prefs.data ?? DEFAULT_PREFS;
		update.mutate({ ...base, ...next });
	}

	return (
		<Card className="min-w-0">
			<CardHeader>
				<CardTitle>Priority</CardTitle>
				<CardDescription>
					What this page should call out first. Saved to your account.
				</CardDescription>
			</CardHeader>

			{prefs.isLoading && !value ? (
				<div className="flex items-center justify-center rounded-lg border py-8">
					<Spinner />
				</div>
			) : value ? (
				<>
					{prefs.isError ? (
						<p>
							Could not load saved priorities — showing defaults. Restart the
							API if this stays broken.
						</p>
					) : null}
					<FieldGroup layout="columns">
						<Field>
							<FieldLabel htmlFor="followup-float">Float first</FieldLabel>
							<Select
								value={value.floatFirst}
								disabled={busy || prefs.isError}
								onValueChange={(floatFirst) =>
									patch({ floatFirst: floatFirst as Prefs["floatFirst"] })
								}
							>
								<SelectTrigger id="followup-float">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{FLOAT_OPTIONS.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>

						<Field>
							<FieldLabel htmlFor="followup-lookback">Look back</FieldLabel>
							<Select
								value={value.lookback}
								disabled={busy || prefs.isError}
								onValueChange={(lookback) =>
									patch({ lookback: lookback as Prefs["lookback"] })
								}
							>
								<SelectTrigger id="followup-lookback">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{LOOKBACK_OPTIONS.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>

						<Field>
							<FieldLabel htmlFor="followup-scope">Whose work</FieldLabel>
							<Select
								value={value.scope}
								disabled={busy || prefs.isError}
								onValueChange={(scope) =>
									patch({ scope: scope as Prefs["scope"] })
								}
							>
								<SelectTrigger id="followup-scope">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{SCOPE_OPTIONS.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
					</FieldGroup>
				</>
			) : null}
		</Card>
	);
}
