"use client";

import { CopyButton } from "@crm/ui/components/copy-button";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";

/**
 * Id text + copy control for Sage CRM / Sage 100 columns and sheet rows.
 */
export function SageIdValue({
	value,
	label,
}: {
	value: string | null | undefined;
	/** Toast label, e.g. "Sage CRM ID copied". */
	label: string;
}) {
	if (!value) return <EmptyCellValue />;
	return (
		<span className="flex min-w-0 items-center gap-1">
			<span className="truncate font-mono text-muted-foreground tabular-nums">
				{value}
			</span>
			<CopyButton value={value} label={label} aria-label={`Copy ${label}`} />
		</span>
	);
}
