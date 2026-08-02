import { cn } from "@crm/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

const alertVariants = cva(
	"group/alert relative grid w-full gap-0.5 rounded-md border px-2.5 py-2 text-left text-xs has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default: "bg-card text-card-foreground",
				/*
				 * Neutral, not red. A failure panel is already announced by its
				 * heading and its position on the page; painting the whole surface
				 * red makes a recoverable problem — an API that needs enabling —
				 * read like data loss. The grey keeps the alert legible and lets the
				 * one action inside it be the loudest thing in the box.
				 */
				destructive:
					"bg-muted text-foreground *:[svg]:text-current *:data-[slot=alert-description]:text-foreground/80",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function Alert({
	className,
	variant,
	attention = 0,
	...props
}: React.ComponentProps<"div"> &
	VariantProps<typeof alertVariants> & {
		/**
		 * Bump this to make the alert re-assert itself.
		 *
		 * A counter rather than a boolean, and it is the `key`: an animation only
		 * replays when the node is new, so a flag flipping back to `true` a second
		 * time would do nothing at all. Every increment remounts the alert and the
		 * animation runs again — which is the whole point, since the case this
		 * exists for is the *same* problem reported twice.
		 */
		attention?: number;
	}) {
	return (
		<div
			key={attention}
			data-slot="alert"
			role="alert"
			className={cn(
				alertVariants({ variant }),
				attention > 0 && "alert-attention",
				className,
			)}
			{...props}
		/>
	);
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-title"
			className={cn(
				"font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
				className,
			)}
			{...props}
		/>
	);
}

function AlertDescription({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-description"
			className={cn(
				"text-xs/relaxed text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-2",
				className,
			)}
			{...props}
		/>
	);
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-action"
			className={cn(
				"absolute top-[calc(--spacing(1.25))] right-[calc(--spacing(1.25))]",
				className,
			)}
			{...props}
		/>
	);
}

export { Alert, AlertAction, AlertDescription, AlertTitle };
