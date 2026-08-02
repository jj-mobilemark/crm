"use client";

import {
	Table,
	TableBody,
	TableHead,
	TableHeader,
	TableRow,
} from "@crm/ui/components/table";
import {
	ROW_ACCENT,
	ROW_ACCENT_EXPANDABLE,
} from "@crm/ui/lib/row-accent";
import { cn } from "@crm/ui/lib/utils";
import type { ComponentProps, ReactNode } from "react";

export type SimpleTableColumn = {
	header?: ReactNode;
	srLabel?: string;
	width?: string;
	align?: "left" | "right" | "center";
	className?: string;
};

const ALIGN_CLASS = {
	left: "",
	right: "text-right",
	center: "text-center",
} as const;

const PANEL_SURFACE = {
	popover: "bg-popover [&_th]:bg-popover",
	page: "bg-background [&_th]:bg-background",
} as const;

export function SimpleTable({
	columns,
	children,
	variant = "default",
	surface = "popover",
	className,
	containerClassName,
	headerClassName,
	headerRowClassName,
	headerHeight,
}: {
	columns: SimpleTableColumn[];
	children: ReactNode;
	/**
	 * `panel` fills the remaining height of a sheet tab and pins the header
	 * while the rows scroll under it. Everywhere else the table is one block in
	 * a column of blocks and scrolls with the page.
	 */
	variant?: "default" | "panel";
	/**
	 * What the pinned header sits on, so it hides the rows passing under it
	 * instead of showing a strip of the wrong surface: `popover` inside a sheet,
	 * `page` inside a panel on the page itself.
	 */
	surface?: keyof typeof PANEL_SURFACE;
	className?: string;
	containerClassName?: string;
	headerClassName?: string;
	headerRowClassName?: string;
	headerHeight?: string;
}) {
	const panel = variant === "panel";

	return (
		<Table
			className={cn("w-full", panel && "table-fixed", className)}
			containerClassName={cn(
				panel && "min-h-0 flex-1 overflow-x-hidden overflow-y-auto",
				// Standalone tables carry their own shell. The `panel` variant does
				// not: it sits inside `CardPanel`, which already draws the border,
				// and two of them read as a box inside a box.
				!panel && "rounded-lg border bg-card",
				containerClassName,
			)}
		>
			<TableHeader
				className={cn(
					panel && ["sticky top-0 z-10", PANEL_SURFACE[surface]],
					// A filled shelf with an inset rule rather than a bottom border,
					// so the line sits inside the shell's rounded corners instead of
					// running out past them.
					!panel &&
						"bg-muted [&_tr]:border-0 [&_tr]:shadow-[inset_0_-1px_0_var(--border)]",
					headerClassName,
				)}
			>
				<TableRow className={cn("hover:bg-transparent", headerRowClassName)}>
					{columns.map((column, index) => (
						<TableHead
							key={index}
							aria-label={column.header ? undefined : column.srLabel}
							className={cn(
								headerHeight ?? "h-9",
								"px-3 font-normal text-muted-foreground",
								column.width,
								ALIGN_CLASS[column.align ?? "left"],
								column.className,
							)}
						>
							{column.header}
						</TableHead>
					))}
				</TableRow>
			</TableHeader>
			<TableBody>{children}</TableBody>
		</Table>
	);
}

export function SimpleTableRow({
	clickable,
	expandable,
	className,
	...props
}: ComponentProps<typeof TableRow> & {
	clickable?: boolean;
	expandable?: boolean;
}) {
	return (
		<TableRow
			className={cn(
				"hover:bg-transparent",
				clickable && (expandable ? ROW_ACCENT_EXPANDABLE : ROW_ACCENT),
				className,
			)}
			{...props}
		/>
	);
}
