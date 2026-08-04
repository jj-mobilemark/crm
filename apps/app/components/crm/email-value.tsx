"use client";

import { CopyButton } from "@crm/ui/components/copy-button";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import type * as React from "react";
import { toast } from "sonner";

/**
 * Email text + copy control for table columns.
 * Click the address (or the copy icon) to copy; both stop the table row click.
 */
export function EmailValue({
	value,
}: {
	value: string | null | undefined;
}) {
	if (!value) return <EmptyCellValue />;
	const email = value;

	function copyEmail(event: React.MouseEvent) {
		event.stopPropagation();
		void navigator.clipboard.writeText(email).then(
			() => toast.success("Email copied"),
			() => toast.error("Could not copy"),
		);
	}

	return (
		<span className="flex min-w-0 items-center gap-1">
			<button
				type="button"
				className="truncate text-muted-foreground hover:text-foreground"
				onClick={copyEmail}
				title={`Copy ${email}`}
			>
				{email}
			</button>
			<CopyButton
				value={email}
				label="Email copied"
				aria-label="Copy email"
			/>
		</span>
	);
}
