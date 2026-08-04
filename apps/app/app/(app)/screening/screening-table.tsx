"use client";

import Checkmark from "@carbon/icons-react/es/Checkmark";
import Close from "@carbon/icons-react/es/Close";
import UserFollow from "@carbon/icons-react/es/UserFollow";
import { Button } from "@crm/ui/components/button";
import { Checkbox } from "@crm/ui/components/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@crm/ui/components/dialog";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@crm/ui/components/empty";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { Icon } from "@crm/ui/components/icon";
import { Label } from "@crm/ui/components/label";
import { Spinner } from "@crm/ui/components/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@crm/ui/components/table";
import { relativeTimeFromIso } from "@crm/ui/lib/format";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { companyNameGuessFromDomain } from "@/lib/company-name-guess";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

type PendingRow = RouterOutputs["screening"]["list"]["rows"][number];
type SimilarMatch =
	RouterOutputs["companies"]["similar"]["matches"][number];

function PendingActions({ row }: { row: PendingRow }) {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const openRecord = useOpenRecord();
	const queryClient = useQueryClient();
	const [suppressDomain, setSuppressDomain] = useState(false);
	const [checking, setChecking] = useState(false);
	const [matches, setMatches] = useState<SimilarMatch[] | null>(null);
	const suppressId = useId();

	const invalidate = async () => {
		await cache.screening();
	};

	const decide = useMutation(
		trpc.screening.decide.mutationOptions({
			onSuccess: async (result) => {
				setMatches(null);
				await invalidate();
				if (result.decision === "approve" && result.contactId) {
					await cache.contact(result.contactId);
					toast.success(
						result.sagePushQueued
							? "Contact created — queued for Sage."
							: "Contact created.",
					);
					openRecord({ kind: "contact", id: result.contactId });
					return;
				}
				toast.success(
					suppressDomain ? "Rejected — domain suppressed." : "Rejected.",
				);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const busy = decide.isPending || checking;

	async function approveWithCompanyCheck() {
		setChecking(true);
		try {
			const name = companyNameGuessFromDomain(row.domain);
			const result = await queryClient.fetchQuery(
				trpc.companies.similar.queryOptions({
					name: name || row.domain,
					domain: row.domain,
				}),
			);
			if (result.matches.length > 0) {
				setMatches([...result.matches]);
				return;
			}
			decide.mutate({ id: row.id, decision: "approve" });
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Could not check for matching companies.",
			);
		} finally {
			setChecking(false);
		}
	}

	function useExisting(companyId: string) {
		decide.mutate({
			id: row.id,
			decision: "approve",
			createContact: { companyId },
		});
	}

	function createFromDomain() {
		decide.mutate({
			id: row.id,
			decision: "approve",
			createContact: { preferDomainCompany: true },
		});
	}

	return (
		<>
			<span className="flex flex-col items-end gap-2">
				<span className="flex items-center gap-2">
					<Button
						size="sm"
						disabled={busy}
						onClick={() => void approveWithCompanyCheck()}
					>
						{checking ? <Spinner /> : <Icon icon={Checkmark} />}
						Approve
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={busy}
						onClick={() =>
							decide.mutate({
								id: row.id,
								decision: "reject",
								suppressDomain,
							})
						}
					>
						<Icon icon={Close} />
						Reject
					</Button>
				</span>
				<span className="flex items-center gap-2">
					<Checkbox
						id={suppressId}
						checked={suppressDomain}
						onCheckedChange={(checked) => setSuppressDomain(checked === true)}
						disabled={busy}
					/>
					<Label htmlFor={suppressId} className="text-muted-foreground">
						Suppress {row.domain}
					</Label>
				</span>
			</span>

			<Dialog
				open={matches !== null}
				onOpenChange={(next) => {
					if (!next && !decide.isPending) setMatches(null);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Matching companies</DialogTitle>
						<DialogDescription>
							{row.domain} may already be in the CRM. The suggested company is
							the best account match (Sage 100, contacts on this domain, size).
							Use it, pick another, or create one named after the domain.
						</DialogDescription>
					</DialogHeader>

					<ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
						{(matches ?? []).map((match) => (
							<li
								key={match.id}
								className={
									match.suggested
										? "flex items-center justify-between gap-3 rounded-md border border-foreground/20 bg-muted/40 px-3 py-2"
										: "flex items-center justify-between gap-3 rounded-md border px-3 py-2"
								}
							>
								<span className="flex min-w-0 flex-col">
									<span className="flex min-w-0 items-baseline gap-2">
										<span className="truncate font-medium">{match.name}</span>
										{match.suggested ? (
											<span className="shrink-0 text-muted-foreground text-xs">
												Suggested
											</span>
										) : null}
									</span>
									<span className="truncate text-muted-foreground text-xs">
										{[
											match.suggestReason,
											match.domain,
											[match.city, match.stateCode].filter(Boolean).join(", "),
											match.sageCrmCompanyId
												? `Sage CRM ${match.sageCrmCompanyId}`
												: null,
											!match.suggestReason && match.contactCount > 0
												? `${match.contactCount} contacts`
												: null,
											!match.suggestReason
												? match.reason === "domain"
													? "Related domain"
													: "Similar name"
												: null,
										]
											.filter(Boolean)
											.join(" · ")}
									</span>
								</span>
								<Button
									type="button"
									variant={match.suggested ? "default" : "outline"}
									size="sm"
									disabled={decide.isPending}
									onClick={() => useExisting(match.id)}
								>
									Use this
								</Button>
							</li>
						))}
					</ul>

					<DialogFooter>
						<Button
							type="button"
							disabled={decide.isPending}
							onClick={createFromDomain}
						>
							{decide.isPending ? <Spinner /> : null}
							Create from domain
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={decide.isPending}
							onClick={() => setMatches(null)}
						>
							Back
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

export function ScreeningTable() {
	const trpc = useTRPC();
	const list = useQuery(trpc.screening.list.queryOptions());
	const rows = list.data?.rows ?? [];

	if (list.isLoading) {
		return (
			<div className="flex flex-1 items-center justify-center py-16">
				<Spinner />
			</div>
		);
	}

	if (rows.length === 0) {
		return (
			<Empty className="flex-1">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<Icon icon={UserFollow} />
					</EmptyMedia>
					<EmptyTitle>Nothing to review</EmptyTitle>
					<EmptyDescription>
						Unmatched external mail will show up here after sync.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	return (
		<div className="min-h-0 flex-1 overflow-auto">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Name</TableHead>
						<TableHead className="hidden md:table-cell">Email</TableHead>
						<TableHead className="hidden lg:table-cell">Domain</TableHead>
						<TableHead className="text-right">Messages</TableHead>
						<TableHead className="hidden md:table-cell">
							Sample subject
						</TableHead>
						<TableHead className="hidden text-right sm:table-cell">
							Last seen
						</TableHead>
						<TableHead className="text-right">
							<span className="sr-only">Actions</span>
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((row) => (
						<TableRow key={row.id}>
							<TableCell>
								{row.displayName ? (
									<span className="font-medium">{row.displayName}</span>
								) : (
									<span className="font-medium text-muted-foreground">
										{row.email}
									</span>
								)}
							</TableCell>
							<TableCell className="hidden text-muted-foreground md:table-cell">
								{row.email}
							</TableCell>
							<TableCell className="hidden lg:table-cell">
								{row.domain}
							</TableCell>
							<TableCell className="text-right">{row.messageCount}</TableCell>
							<TableCell className="hidden text-muted-foreground md:table-cell">
								{row.sampleSubject ? (
									<span className="truncate">{row.sampleSubject}</span>
								) : (
									<EmptyCellValue />
								)}
							</TableCell>
							<TableCell
								className="hidden text-right text-muted-foreground sm:table-cell"
								suppressHydrationWarning
							>
								{relativeTimeFromIso(row.lastSeenAt)}
							</TableCell>
							<TableCell className="text-right">
								<PendingActions row={row} />
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
