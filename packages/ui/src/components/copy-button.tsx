"use client";

import Copy from "@carbon/icons-react/es/Copy";
import type * as React from "react";
import { toast } from "sonner";
import { Button } from "./button";

/**
 * Icon-only copy control. Lives in `packages/ui` so every call site shares one
 * toast and one glyph — no call-site style overrides.
 */
export function CopyButton({
	value,
	label = "Copied",
	"aria-label": ariaLabel = "Copy",
}: {
	value: string;
	/** Toast message after a successful copy. */
	label?: string;
	"aria-label"?: string;
}) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-xs"
			aria-label={ariaLabel}
			onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
				// Tables open a row on click; stop that when the user means copy.
				event.stopPropagation();
				void navigator.clipboard.writeText(value).then(
					() => toast.success(label),
					() => toast.error("Could not copy"),
				);
			}}
		>
			<Copy />
		</Button>
	);
}
