"use client";

import type { DealStage } from "@crm/db/enums";
import { DealStageMenu } from "@/components/crm/stage-change";
import { useDealEditAccess } from "@/components/crm/use-deal-edit-access";

/** Stage control that respects owner / admin edit rights. */
export function OwnedDealStageMenu({
	dealId,
	stage,
	ownerId,
	variant = "inline",
}: {
	dealId: string;
	stage: DealStage;
	ownerId: string;
	variant?: "inline" | "control";
}) {
	const { canEdit } = useDealEditAccess(ownerId);
	return (
		<DealStageMenu
			dealId={dealId}
			stage={stage}
			variant={variant}
			disabled={!canEdit}
		/>
	);
}
