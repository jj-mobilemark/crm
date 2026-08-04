"use client";

import MagicWand from "@carbon/icons-react/es/MagicWand";
import Renew from "@carbon/icons-react/es/Renew";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import { Spinner } from "@crm/ui/components/spinner";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

/**
 * The two things a rep can ask the agent for.
 *
 * Both are background work with no immediate result to show, so neither
 * navigates or blocks: the enrichment chip in the header goes to "Enriching"
 * and the page polls until it settles, and the brief appears on the timeline.
 *
 * Re-enrich needs a domain (Context.dev brand lookup). Research does not —
 * with no site it falls back to Perplexity by company name when configured.
 */
export function EnrichmentActions({
	companyId,
	hasDomain,
}: {
	companyId: string;
	hasDomain: boolean;
}) {
	const trpc = useTRPC();
	const cache = useCrmCache();

	const enrich = useMutation(
		trpc.companies.enrich.mutationOptions({
			onSuccess: async (result) => {
				await cache.company(companyId);
				toast.success(
					result.queued
						? "Looking it up — this page will update when it finishes."
						: "Already running.",
				);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const research = useMutation(
		trpc.companies.research.mutationOptions({
			onSuccess: async () => {
				await cache.company(companyId);
				await cache.activity();
				toast.success(
					"Research queued — the brief will land on the timeline.",
				);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	// These sit in the sheet header, which on a phone is a full-width drawer
	// with a logo and a name already in it. The labels drop below `sm` so the
	// record's name keeps the room rather than two buttons about the agent.
	return (
		<>
			<Button
				variant="outline"
				size="sm"
				disabled={!hasDomain || enrich.isPending}
				title={
					hasDomain
						? "Refresh brand data from the domain"
						: "Add a domain or website first — brand lookup needs one"
				}
				onClick={() => enrich.mutate({ id: companyId })}
			>
				{enrich.isPending ? (
					<Spinner />
				) : (
					<Icon icon={Renew} data-icon="inline-start" />
				)}
				<span className="hidden sm:inline">Re-enrich</span>
			</Button>

			{/* Research is the action on this record, so it takes the fill.
			 * Re-enrich beside it is the quieter "do that again". */}
			<Button
				size="sm"
				disabled={research.isPending}
				title="Write a research brief to the timeline"
				onClick={() => research.mutate({ id: companyId })}
			>
				{research.isPending ? (
					<Spinner />
				) : (
					<Icon icon={MagicWand} data-icon="inline-start" />
				)}
				<span className="hidden sm:inline">Research</span>
			</Button>
		</>
	);
}
