"use client";

import { CopyButton } from "@crm/ui/components/copy-button";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import type * as React from "react";
import { toast } from "sonner";

/**
 * Id text + copy control for Sage CRM / Sage 100 columns and sheet rows.
 * Click the id (or the copy icon) to copy; both stop the table row click.
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
	const id = value;

	function copyId(event: React.MouseEvent) {
		event.stopPropagation();
		void navigator.clipboard.writeText(id).then(
			() => toast.success(label),
			() => toast.error("Could not copy"),
		);
	}

	return (
		<span className="flex min-w-0 items-center gap-1">
			<button
				type="button"
				className="truncate font-mono text-muted-foreground tabular-nums hover:text-foreground"
				onClick={copyId}
				title={`Copy ${id}`}
			>
				{id}
			</button>
			<CopyButton value={id} label={label} aria-label={`Copy ${label}`} />
		</span>
	);
}
