import { cn } from "@crm/ui/lib/utils";
import type * as React from "react";

/**
 * A small count bubble for nav icons and similar anchors.
 *
 * Renders nothing when `count` is 0 or less. Caps the label at 99+ so a wide
 * number never pushes the rail.
 *
 * - `overlay` (default): absolute top-right on a `relative` parent (icon rail).
 * - `inline`: sits in normal flow (mobile nav row).
 */
function CountBadge({
	count,
	placement = "overlay",
	className,
	...props
}: Omit<React.ComponentProps<"span">, "children"> & {
	count: number;
	placement?: "overlay" | "inline";
}) {
	if (count <= 0) return null;

	const label = count > 99 ? "99+" : String(count);

	return (
		<span
			data-slot="count-badge"
			data-placement={placement}
			aria-hidden
			className={cn(
				"pointer-events-none z-10 inline-flex items-center justify-center rounded-full bg-primary font-medium text-primary-foreground leading-none tabular-nums ring-2 ring-background",
				placement === "overlay" &&
					"absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 text-[10px]",
				placement === "inline" && "h-5 min-w-5 px-1.5 text-[11px]",
				className,
			)}
			{...props}
		>
			{label}
		</span>
	);
}

export { CountBadge };
