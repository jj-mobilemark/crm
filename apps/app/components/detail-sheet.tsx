"use client";

import ArrowLeft from "@carbon/icons-react/es/ArrowLeft";
import Close from "@carbon/icons-react/es/Close";
import { Button } from "@crm/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@crm/ui/components/empty";
import type { CarbonIcon } from "@crm/ui/components/icon";
import { Icon } from "@crm/ui/components/icon";
import { Separator } from "@crm/ui/components/separator";
import type { SheetSize } from "@crm/ui/components/sheet";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@crm/ui/components/tabs";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@crm/ui/components/tooltip";
import { cn } from "@crm/ui/lib/utils";
import { type ReactNode, useRef, useState } from "react";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/responsive-sheet";

/** One gutter for the whole panel, so every band lines up down the left edge. */
const GUTTER = "px-5";

/**
 * Section headings are eyebrows, not titles.
 *
 * The only title in a record sheet is the record's name. "Details" and "About"
 * are labels on a filing cabinet — they need to be findable when you scan for
 * them and invisible when you are not.
 */
export const SECTION_TITLE =
	"font-medium text-muted-foreground text-xs uppercase tracking-wider";

/**
 * The one label column every property in every sheet is measured against.
 *
 * Exported because the editable rows in `crm/inline-field` are the same row
 * with a control in the value slot. Two definitions is how the Background block
 * ended up nine pixels left of the Details block above it — near enough to look
 * accidental, far enough to see.
 */
export const PROPERTY_ROW = "grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2";

/**
 * The label in that column, on every kind of row.
 *
 * Same size as the value it labels. Everything in a sheet is `text-xs` — which
 * is what `Button`, `Input`, `Select` and `Table` already are, so the panel is
 * uniform only as long as nothing overrides them upward. Hierarchy comes from
 * colour: a muted label against a foreground value.
 */
export const PROPERTY_LABEL = "truncate text-muted-foreground text-xs";

/**
 * A read-only row wears the box an editable one already has.
 *
 * An editable value lives in a ghost button — one pixel of transparent border,
 * `px-2` of padding — so anything set flat beside it starts nine pixels
 * further left. Giving both cells of a read-only row the same invisible box is
 * what keeps a section of facts and a section of fields on one edge.
 */
const PROPERTY_CELL = "border border-transparent py-1";

/**
 * The chrome every record sheet is built from.
 *
 * One shape for all of them — header, a strip of numbers, tabs, a scrolling
 * body — so a rep who has opened a company knows where everything is on a deal
 * without looking.
 *
 * `showCloseButton={false}`: the close control is part of the header's action
 * group instead of floating over the top-right corner, which is the only way
 * a record's own buttons can sit up there without being crowded by it.
 */
export function DetailSheet({
	open,
	onOpenChange,
	size = "2xl",
	className,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	size?: SheetSize;
	className?: string;
	children: ReactNode;
}) {
	const content = useRef<HTMLDivElement>(null);

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				ref={content}
				side="right"
				size={size}
				showCloseButton={false}
				// Opening a record is a read, not a form. Left alone, Radix puts
				// focus on the first control in the panel, so the sheet arrives with
				// a focus ring already drawn on a button nobody pressed. Focusing the
				// panel itself keeps assistive tech inside the dialog and announces
				// the record's name, without anything looking pre-clicked.
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					content.current?.focus();
				}}
				className={cn("flex flex-col gap-0 p-0", className)}
			>
				{children}
			</SheetContent>
		</Sheet>
	);
}

export function DetailSheetHeader({
	media,
	title,
	description,
	note,
	actions,
	onBack,
	onClose,
}: {
	media?: ReactNode;
	title: ReactNode;
	/** The one line that says what this is — domain, company, location. */
	description?: ReactNode;
	/** Only when there is something to say: an agent running, a failure. */
	note?: ReactNode;
	actions?: ReactNode;
	/** Up one record, when this was opened from another one. */
	onBack?: () => void;
	onClose: () => void;
}) {
	return (
		<SheetHeader className={cn("gap-0 border-b py-3", GUTTER)}>
			<div className="flex items-start gap-3">
				{onBack ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="icon-sm" onClick={onBack}>
								<Icon icon={ArrowLeft} />
								<span className="sr-only">Back</span>
							</Button>
						</TooltipTrigger>
						<TooltipContent>Back</TooltipContent>
					</Tooltip>
				) : null}

				{media}

				<div className="min-w-0 flex-1 space-y-0.5 pt-0.5">
					<SheetTitle size="lg" className="wrap-anywhere">
						{title}
					</SheetTitle>
					{description ? (
						<SheetDescription className="wrap-anywhere">
							{description}
						</SheetDescription>
					) : null}
					{note ? (
						<div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-xs">
							{note}
						</div>
					) : null}
				</div>

				{/*
				 * Actions and close travel together, so the record's own buttons can
				 * never end up underneath the close control.
				 */}
				<div className="flex shrink-0 items-center gap-1">
					{actions}
					{actions ? (
						<Separator orientation="vertical" className="mx-1 h-5" />
					) : null}
					<Button variant="ghost" size="icon-sm" onClick={onClose}>
						<Icon icon={Close} />
						<span className="sr-only">Close</span>
					</Button>
				</div>
			</div>
		</SheetHeader>
	);
}

/**
 * The numbers you would otherwise open a tab to find.
 *
 * Deliberately not the counts already printed on the tabs beside them — a
 * strip that repeats "Contacts 3" under a tab reading "Contacts 3" is a band
 * of furniture, not information.
 */
export function DetailSheetStats({ children }: { children: ReactNode }) {
	// A filled shelf rather than a bare band: the stats sit above the tabs and
	// below the identity, and the fill is what separates the three.
	return (
		<dl className="flex shrink-0 divide-x border-b bg-muted/40">{children}</dl>
	);
}

export function DetailSheetStat({
	label,
	children,
}: {
	label: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className={cn("flex min-w-0 flex-1 flex-col gap-1 py-2.5", GUTTER)}>
			<dt className="truncate text-muted-foreground text-xs/5">{label}</dt>
			{/* The value outranks its label — it is the thing you opened the sheet
			 * to read, and at the same size the two competed. */}
			<dd className="min-w-0 truncate font-medium text-foreground text-sm/5">
				{children}
			</dd>
		</div>
	);
}

export type DetailSheetTab = {
	value: string;
	label: string;
	/** Shown next to the label — omit rather than render a zero. */
	count?: number | null;
	content: ReactNode;
	/**
	 * Keep this tab rendered while another one is showing.
	 *
	 * Off by default, and it should stay off for anything that is a view of
	 * data: a table nobody is looking at should not hold a subscription open.
	 *
	 * It is on for the Agent tab because that panel holds a *live connection*.
	 * Unmounting it aborts the stream mid-answer, and the reply then lands in
	 * the durable session with nothing attached to receive it — so coming back
	 * to the tab showed a question with no answer under it, and no amount of
	 * re-reading state on the way back in could conjure the events that were
	 * dropped while it was gone. A conversation you can walk away from is the
	 * whole point of the panel.
	 *
	 * It is *keep* mounted, not *always* mounted: nothing renders until the tab
	 * has been opened once. A rep flicking through twenty records should not
	 * load twenty transcripts from an agent they never asked anything.
	 */
	keepMounted?: boolean;
};

/**
 * The tabs inside a record sheet.
 *
 * The active tab is component state, not a URL param: the sheet's identity is
 * already in `?record=`, and putting the tab there too would mean every glance
 * at "Activity" is a history entry the back button has to walk through before
 * it closes the sheet.
 */
export function DetailSheetTabs({
	tabs,
	value,
	onValueChange,
}: {
	tabs: DetailSheetTab[];
	value: string;
	onValueChange: (value: string) => void;
}) {
	// Which tabs have been looked at. A `keepMounted` tab costs nothing until
	// it is opened, and from then until the sheet closes it stays alive.
	const [opened] = useState(() => new Set<string>());
	opened.add(value);

	return (
		<Tabs
			value={value}
			onValueChange={onValueChange}
			className="flex min-h-0 flex-1 flex-col gap-0"
		>
			{/*
			 * Tabs only. A panel's actions live in the panel — a button bolted to
			 * the right of the tab strip reads as part of the navigation, and the
			 * one thing it is not is somewhere you can go.
			 */}
			<TabsList
				variant="line"
				className={cn("w-full shrink-0 justify-start gap-6 border-b", GUTTER)}
			>
				{tabs.map((tab) => (
					<TabsTrigger key={tab.value} value={tab.value}>
						{tab.label}
						{tab.count ? (
							<span className="text-muted-foreground tabular-nums">
								{tab.count}
							</span>
						) : null}
					</TabsTrigger>
				))}
			</TabsList>

			{/*
			 * The panel does not scroll — whatever is inside it does. A tab of
			 * sections wraps itself in `DetailSheetBody`; a tab that is one long
			 * table lets the table scroll under its own pinned header. Scrolling
			 * here as well would give both of those a second scrollbar.
			 */}
			{tabs.map((tab) => (
				<TabsContent
					key={tab.value}
					value={tab.value}
					forceMount={
						tab.keepMounted && opened.has(tab.value) ? true : undefined
					}
					// `data-[state=inactive]:hidden` is load-bearing under
					// `forceMount`: Radix marks the panel hidden, and `display:flex`
					// on the same element wins over the `hidden` attribute, so
					// without it a kept-alive tab renders on top of the visible one.
					className="flex min-h-0 flex-1 flex-col overflow-hidden outline-none data-[state=inactive]:hidden"
				>
					{tab.content}
				</TabsContent>
			))}
		</Tabs>
	);
}

/** The scroll container for a tab made of sections rather than one table. */
export function DetailSheetBody({ children }: { children: ReactNode }) {
	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
			{children}
		</div>
	);
}

export function DetailSheetSection({
	title,
	action,
	className,
	children,
}: {
	title?: ReactNode;
	action?: ReactNode;
	className?: string;
	children: ReactNode;
}) {
	return (
		<section
			className={cn(
				"space-y-2 border-b py-3 last:border-b-0",
				GUTTER,
				className,
			)}
		>
			{title || action ? (
				<div className="flex h-5 items-center justify-between gap-3">
					{title ? <h3 className={SECTION_TITLE}>{title}</h3> : <span />}
					{action}
				</div>
			) : null}
			{children}
		</section>
	);
}

/**
 * An overview in two columns: what the record *is* on the left, what we know
 * *about* it on the right.
 *
 * One column made the sheet a long list of label/value rows with the useful
 * prose at the bottom, so a rep opening a company scrolled past eight fields to
 * reach the description and never saw the contacts at all. Collapses below `lg`,
 * where a rail would be too narrow to hold a value.
 */
export function DetailSheetSplit({ children }: { children: ReactNode }) {
	return (
		<div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
			{children}
		</div>
	);
}

/** The wide half of a split: prose, and the records hanging off this one. */
export function DetailSheetMain({ children }: { children: ReactNode }) {
	return <div className="flex min-w-0 flex-1 flex-col">{children}</div>;
}

/** The narrow half of a split: the record's own fields, and its gaps. */
export function DetailSheetRail({ children }: { children: ReactNode }) {
	// `min-w-0` so a long value truncates inside the rail instead of pushing it
	// wider than the sheet and running off the edge of the screen.
	return (
		<div className="flex w-full min-w-0 shrink-0 flex-col lg:w-80">
			{children}
		</div>
	);
}

/**
 * Two columns of editable properties on a wide panel, one on a narrow one.
 *
 * Paired rather than a single list because a company has eight of these and a
 * single column turns the first screen of the sheet into a ladder you scroll.
 */
export function DetailSheetProperties({
	children,
	columns = 2,
}: {
	children: ReactNode;
	/**
	 * One column when the properties sit in a `DetailSheetRail`.
	 *
	 * Each row is a 6.5rem label plus its value, so two of them inside a 288px
	 * rail leave about 32px for the value and every one of them clips. Two
	 * columns is right across a full-width panel and wrong anywhere narrow.
	 */
	columns?: 1 | 2;
}) {
	return (
		<div className={cn("grid gap-x-8", columns === 2 && "sm:grid-cols-2")}>
			{children}
		</div>
	);
}

/**
 * What the agent has not filled in yet, as one line rather than a column of
 * em dashes.
 *
 * An empty field rendered as "—" costs a full row and says nothing; five of
 * them say nothing five times. Naming the gaps once, next to the fact that
 * something is working on them, is the same information in a tenth of the
 * space — and it gives the agent a visible presence on a record, which matters
 * in a product whose whole premise is that the agent does the looking.
 */
export function DetailSheetPending({
	fields,
	running,
}: {
	fields: string[];
	running: boolean;
}) {
	if (fields.length === 0) return null;

	return (
		<div className="flex flex-col gap-1.5 rounded-md bg-muted/40 p-3">
			<div className="flex items-center gap-2">
				<span
					aria-hidden
					className={cn(
						"size-1.5 shrink-0 rounded-full",
						running ? "bg-primary" : "bg-muted-foreground",
					)}
				/>
				<span className="font-medium text-xs">
					{running ? "Agent is researching" : "Not known yet"}
				</span>
			</div>
			<p className="text-pretty text-muted-foreground text-xs/5">
				{fields.join(", ")}
			</p>
		</div>
	);
}

/**
 * A property nobody can edit — a fact the agent found, a count we derived.
 *
 * The read-only twin of `InlineField`, sharing its label column and its value
 * indent so a section of these under a section of those reads as one table
 * rather than two that nearly line up.
 *
 * `wide` for the ones that are a sentence rather than a value — a list of
 * previous employers, the names of everyone else at the company. Half a panel
 * turns those into a three-line paragraph wearing a label.
 */
export function DetailSheetProperty({
	label,
	wide = false,
	children,
}: {
	label: ReactNode;
	wide?: boolean;
	children: ReactNode;
}) {
	return (
		<div className={cn(PROPERTY_ROW, "items-start", wide && "sm:col-span-2")}>
			{/* `text-xs/5` so the label's line box is the value's, and the two sit on
			    one baseline without either being nudged by hand. */}
			<span className={cn(PROPERTY_LABEL, PROPERTY_CELL, "text-xs/5")}>
				{label}
			</span>
			<div className={cn(PROPERTY_CELL, "min-w-0 px-2 text-xs/5")}>
				{children}
			</div>
		</div>
	);
}

/**
 * The one paragraph shape in the panel — a company's description, a contact's
 * background.
 *
 * Full width, not measured. A `max-w-prose` here looked like the text had been
 * cut off rather than set: the properties beneath it run the width of the
 * panel, so a paragraph stopping two thirds of the way across reads as a
 * rendering fault. At `text-xs` the line is short enough anyway.
 */
export function DetailSheetProse({ children }: { children: ReactNode }) {
	return (
		<p className="text-pretty text-muted-foreground text-xs/5">{children}</p>
	);
}

/**
 * Nothing here yet, said once, the same way everywhere.
 *
 * A real empty state rather than a line of grey text: an empty panel is the
 * most common thing a rep sees on a company they just added, so it is the one
 * place the app has to say what this list is for and how to start it.
 */
export function DetailSheetEmpty({
	icon,
	title,
	description,
	action,
}: {
	icon: CarbonIcon;
	title: string;
	description: string;
	action?: ReactNode;
}) {
	return (
		<Empty className="flex-1">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<Icon icon={icon} />
				</EmptyMedia>
				<EmptyTitle>{title}</EmptyTitle>
				<EmptyDescription>{description}</EmptyDescription>
			</EmptyHeader>
			{action ? <EmptyContent>{action}</EmptyContent> : null}
		</Empty>
	);
}
