"use client";

import Checkmark from "@carbon/icons-react/es/Checkmark";
import ChevronDown from "@carbon/icons-react/es/ChevronDown";
import Close from "@carbon/icons-react/es/Close";
import Idea from "@carbon/icons-react/es/Idea";
import Time from "@carbon/icons-react/es/Time";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@crm/ui/components/dropdown-menu";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@crm/ui/components/empty";
import { Icon } from "@crm/ui/components/icon";
import { Spinner } from "@crm/ui/components/spinner";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@crm/ui/components/table";
import { relativeTimeFromIso } from "@crm/ui/lib/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { RecordLink } from "@/components/crm/record-sheet/record-link";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

type SuggestionRow = RouterOutputs["followups"]["list"]["rows"][number];

const KIND_LABEL: Record<string, string> = {
	commitment: "Commitment",
	"reply-owed": "Reply owed",
	"deal-risk": "Deal at risk",
	"next-step": "Next step",
};

/** Quick snooze windows — a date picker is more control than this needs. */
const SNOOZE_OPTIONS = [
	{ label: "Tomorrow", days: 1 },
	{ label: "In 3 days", days: 3 },
	{ label: "Next week", days: 7 },
] as const;

function SuggestionActions({ row }: { row: SuggestionRow }) {
	const trpc = useTRPC();
	const cache = useCrmCache();

	const decide = useMutation(
		trpc.followups.decide.mutationOptions({
			onSuccess: async (result) => {
				await cache.followup();
				if (result.decision === "accept") toast.success("Added to your tasks.");
				if (result.decision === "snooze") toast.success("Snoozed.");
				if (result.decision === "dismiss") toast.success("Dismissed.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const busy = decide.isPending;

	return (
		<span className="flex items-center justify-end gap-2">
			{busy ? (
				<Spinner className="size-4" />
			) : (
				<>
					<Button
						size="sm"
						onClick={() => decide.mutate({ id: row.id, decision: "accept" })}
					>
						<Icon icon={Checkmark} />
						Accept
					</Button>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button size="sm" variant="outline">
								<Icon icon={Time} />
								Snooze
								<Icon icon={ChevronDown} />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							{SNOOZE_OPTIONS.map((option) => (
								<DropdownMenuItem
									key={option.label}
									onSelect={() =>
										decide.mutate({
											id: row.id,
											decision: "snooze",
											dueAt: daysFromNow(option.days),
										})
									}
								>
									{option.label}
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
					<Button
						size="sm"
						variant="outline"
						onClick={() => decide.mutate({ id: row.id, decision: "dismiss" })}
					>
						<Icon icon={Close} />
						Dismiss
					</Button>
				</>
			)}
		</span>
	);
}

function SuggestionSubject({ row }: { row: SuggestionRow }) {
	if (row.deal) {
		return (
			<RecordLink kind="deal" id={row.deal.id} className="text-foreground">
				{row.deal.name}
			</RecordLink>
		);
	}
	if (row.contact) {
		return (
			<RecordLink
				kind="contact"
				id={row.contact.id}
				className="text-foreground"
			>
				{row.contact.name}
			</RecordLink>
		);
	}
	if (row.company) {
		return (
			<RecordLink
				kind="company"
				id={row.company.id}
				className="text-foreground"
			>
				{row.company.name}
			</RecordLink>
		);
	}
	return null;
}

export function SuggestionsPanel() {
	const trpc = useTRPC();
	const list = useQuery(trpc.followups.list.queryOptions());
	const rows = list.data?.rows ?? [];

	return (
		<Card className="min-w-0">
			<CardHeader>
				<CardTitle>Suggested follow-ups</CardTitle>
				<CardDescription>
					Grounded in your own synced mail — every one cites a real message.
				</CardDescription>
			</CardHeader>

			{list.isLoading ? (
				<div className="flex items-center justify-center rounded-lg border py-12">
					<Spinner />
				</div>
			) : rows.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Icon icon={Idea} />
						</EmptyMedia>
						<EmptyTitle>Nothing outstanding</EmptyTitle>
						<EmptyDescription>
							The daily sweep runs against your synced mail and open deals.
							Suggestions will show up here once it finds something worth
							raising.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="overflow-auto rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Suggestion</TableHead>
								<TableHead className="hidden md:table-cell">Kind</TableHead>
								<TableHead className="hidden lg:table-cell">About</TableHead>
								<TableHead className="hidden text-right sm:table-cell">
									{" "}
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
										<span className="flex min-w-0 flex-col gap-0.5">
											<span className="font-medium">{row.summary}</span>
											{row.quote ? (
												<span className="truncate text-muted-foreground italic">
													“{row.quote}”
												</span>
											) : null}
										</span>
									</TableCell>
									<TableCell className="hidden md:table-cell">
										<StatusIndicator
											tone="neutral"
											label={KIND_LABEL[row.kind] ?? row.kind}
										/>
									</TableCell>
									<TableCell className="hidden text-muted-foreground lg:table-cell">
										<SuggestionSubject row={row} />
									</TableCell>
									<TableCell
										className="hidden text-right text-muted-foreground sm:table-cell"
										suppressHydrationWarning
									>
										{row.status === "SNOOZED"
											? `Snoozed until ${relativeTimeFromIso(row.dueHint)}`
											: null}
									</TableCell>
									<TableCell className="text-right">
										<SuggestionActions row={row} />
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</Card>
	);
}

function daysFromNow(days: number): string {
	const date = new Date();
	date.setDate(date.getDate() + days);
	return date.toISOString();
}
