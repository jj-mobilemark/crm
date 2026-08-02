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
				await cache.activity();
				toast.success("Brief added to the timeline.");
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
				// Without a domain there is nothing to look up, and the API would only
				// come back and say so.
				disabled={!hasDomain || enrich.isPending}
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
				disabled={!hasDomain || research.isPending}
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
