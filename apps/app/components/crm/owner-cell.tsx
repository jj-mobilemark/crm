"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@crm/ui/components/avatar";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@crm/ui/components/tooltip";
import { initialsFromName } from "@crm/ui/lib/format";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { usePrefetchRecord } from "@/components/crm/record-sheet/record-prefetch";

export type Owner = {
	id: string;
	name: string;
	email: string;
	image: string | null;
};

/** The person a company, contact or deal is assigned to. */
export function OwnerCell({
	owner,
	/** Avatar only — for tight spots like a board card footer. */
	compact = false,
}: {
	owner: Owner | null;
	compact?: boolean;
}) {
	const openRecord = useOpenRecord();
	const prefetchRecord = usePrefetchRecord();

	if (!owner) return compact ? null : <EmptyCellValue />;

	const open = () => openRecord({ kind: "user", id: owner.id });
	const prefetch = () => prefetchRecord({ kind: "user", id: owner.id });

	const avatar = (
		<Avatar size="sm">
			{owner.image ? <AvatarImage src={owner.image} alt="" /> : null}
			<AvatarFallback>{initialsFromName(owner.name)}</AvatarFallback>
		</Avatar>
	);

	if (compact) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
						onClick={(event) => {
							event.stopPropagation();
							open();
						}}
						onMouseEnter={prefetch}
						onFocus={prefetch}
						aria-label={`Open ${owner.name}`}
					>
						{avatar}
					</button>
				</TooltipTrigger>
				<TooltipContent>{owner.name}</TooltipContent>
			</Tooltip>
		);
	}

	return (
		<button
			type="button"
			className="flex min-w-0 items-center gap-2 text-left outline-none hover:underline focus-visible:underline"
			onClick={(event) => {
				event.stopPropagation();
				open();
			}}
			onMouseEnter={prefetch}
			onFocus={prefetch}
		>
			{avatar}
			<span className="truncate">{owner.name}</span>
		</button>
	);
}
