"use client";

import { DealStage } from "@crm/db/enums";
import { cn } from "@crm/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
	DealStageIndicator,
	dealStageLabel,
	isClosedStage,
	OPEN_STAGES,
} from "@/components/crm/deal-stage";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

/**
 * Won is the end of the pipeline, so it is the last step on the rail.
 *
 * Lost and unqualified are not — they are exits, they can happen from any
 * step, and the API refuses them without a reason. Those stay in the stage
 * control in the header, which knows to ask why.
 */
const RAIL = [...OPEN_STAGES, DealStage.CLOSED_WON] as readonly DealStage[];

/**
 * How far along the deal is, as a rail of segments.
 *
 * Mostly the picture, not the picker — jumping backwards, reopening and
 * closing-as-lost live in the stage control in the sheet header, next to the
 * record's name where the other sheets keep their state. What is here is the
 * move a rep makes constantly: nudging a deal to the next step, in one click,
 * all the way through to won.
 */
export function StageStepper({
	dealId,
	stage,
	disabled = false,
}: {
	dealId: string;
	stage: DealStage;
	/** Owner-only lock — rail stays visible but clicks do nothing. */
	disabled?: boolean;
}) {
	const trpc = useTRPC();
	const cache = useCrmCache();

	const setStage = useMutation(
		trpc.deals.setStage.mutationOptions({
			onSuccess: async (result) => {
				await cache.deal(dealId);
				if (result.changed) toast.success("Stage updated.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	// A deal that was lost or disqualified never reached won, so the rail shows
	// its four open steps unlit and hands the last segment to the outcome.
	const exited = isClosedStage(stage) && stage !== DealStage.CLOSED_WON;
	const steps = exited ? OPEN_STAGES : RAIL;
	const currentIndex = steps.indexOf(stage);

	return (
		<ol className="flex w-full gap-1">
			{steps.map((option, index) => {
				const reached = !exited && index <= currentIndex;
				const current = !exited && option === stage;
				return (
					<li key={option} className="flex min-w-0 flex-1">
						<button
							type="button"
							aria-current={current ? "step" : undefined}
							disabled={disabled || setStage.isPending}
							onClick={() => {
								if (disabled) return;
								setStage.mutate({ id: dealId, stage: option });
							}}
							className={cn(
								"min-w-0 flex-1 border-t-2 pt-2 text-left text-xs transition-colors disabled:pointer-events-none disabled:opacity-50",
								reached
									? "border-foreground text-foreground"
									: "border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground",
								current && "font-medium",
							)}
						>
							<span className="block truncate">
								{/* The last segment is the outcome slot: the win the deal is
								    heading for while it is open, and the actual result once
								    it is not. */}
								{current && option === DealStage.CLOSED_WON ? (
									<DealStageIndicator stage={stage} className="text-xs" />
								) : (
									dealStageLabel(option)
								)}
							</span>
						</button>
					</li>
				);
			})}

			{/*
			 * Lost or disqualified, as the final segment. Not a button: coming back
			 * into the pipeline means choosing a step, which the four to its left
			 * already do, and a rail whose end undoes itself on click is a trap.
			 */}
			{exited ? (
				<li className="flex min-w-0 flex-1">
					<div className="min-w-0 flex-1 border-foreground border-t-2 pt-2">
						<DealStageIndicator stage={stage} className="text-xs" />
					</div>
				</li>
			) : null}
		</ol>
	);
}
