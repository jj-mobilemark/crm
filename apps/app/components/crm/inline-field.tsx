"use client";

import { Button } from "@crm/ui/components/button";
import { DatePicker } from "@crm/ui/components/date-picker";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { Input } from "@crm/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { SOURCED_VALUE, SourcedValue } from "@crm/ui/components/sourced-value";
import { Spinner } from "@crm/ui/components/spinner";
import { cn } from "@crm/ui/lib/utils";
import { useId, useState } from "react";
import { PROPERTY_LABEL, PROPERTY_ROW } from "@/components/detail-sheet";

// The row shape is the sheet's, not this file's — a read-only fact and an
// editable field are the same row with a different value slot.
const ROW = cn(PROPERTY_ROW, "items-center");
const LABEL = PROPERTY_LABEL;
/**
 * Values look like text until you point at one.
 *
 * A row of boxed inputs shouts "form" at someone who came here to read a
 * record; a row of plain text gives no hint that a typo is one click from
 * fixed. The hover outline is the whole affordance, and it is the same on a
 * typed field and a chosen one so nothing looks more editable than the rest.
 */
const CONTROL =
	"h-8 w-full justify-start px-2 font-normal hover:border-input hover:bg-muted/40 border border-transparent";

/**
 * Which property a record's shared update mutation is currently writing.
 *
 * One `update` serves every row in a sheet, so its `isPending` says only that
 * *something* is saving. Handing that to each row puts a spinner on all seven
 * of them the moment you correct one — the whole form flashes for a write to a
 * single field. The variables of the write name the field, so the spinner can
 * land on the row that was actually edited and nowhere else.
 */
export function savingField(update: {
	isPending: boolean;
	variables?: { data?: object } | undefined;
}): (field: string) => boolean {
	const fields = update.isPending
		? Object.keys(update.variables?.data ?? {})
		: [];
	return (field) => fields.includes(field);
}

export function InlineField({
	label,
	value,
	onSave,
	saving = false,
	placeholder,
	type = "text",
	render,
	provenance,
	suggestion,
	readOnly = false,
}: {
	label: string;
	value: string | null;
	onSave: (next: string) => void;
	saving?: boolean;
	placeholder?: string;
	type?: "text" | "url" | "email" | "tel";
	/** How the saved value reads when not being edited — a link, usually. */
	render?: (value: string) => React.ReactNode;
	/**
	 * Where this value came from, when a machine put it there.
	 *
	 * Left off, the field looks exactly as it always did — which is the right
	 * default for the ones a person typed, and the only reason the underline
	 * means anything on the ones they did not.
	 */
	provenance?: React.ReactNode;
	/**
	 * Something the agent believes but is not sure enough to write. Rendered
	 * *under* the field, never inside it: a suggestion that looks like a value
	 * is a lie with a nice font.
	 */
	suggestion?: React.ReactNode;
	/** Owner-only / permission lock — shows the value with no edit affordance. */
	readOnly?: boolean;
}) {
	const id = useId();
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(value ?? "");

	const commit = () => {
		setEditing(false);
		if (draft.trim() !== (value ?? "")) onSave(draft.trim());
	};

	// Mid-write, the row reads back what was typed rather than what the record
	// still says. The input closes on commit but the new value only arrives with
	// the refetch, so reading `value` here would show the old one for the length
	// of a round trip — which looks like the edit was thrown away.
	const shown = saving ? draft.trim() : (value ?? "");

	const sourced = Boolean(provenance) && !editing && shown !== "";

	if (readOnly) {
		return (
			<div className={ROW}>
				<span className={LABEL}>{label}</span>
				<div className="min-w-0 px-2 text-sm">
					{shown ? (
						<span className="truncate">{render ? render(shown) : shown}</span>
					) : (
						<span className="text-muted-foreground">
							{placeholder ?? <EmptyCellValue />}
						</span>
					)}
				</div>
			</div>
		);
	}

	/**
	 * A single element, never a fragment.
	 *
	 * When this row carries provenance it becomes a tooltip trigger, and Radix's
	 * `asChild` clones the child to pass `aria-describedby` and its open state
	 * onto it. A fragment cannot take props, so wrapping the ternary in one threw
	 * `Invalid prop \`aria-describedby\` supplied to \`React.Fragment\`` — on
	 * every field in the sheet, because the trigger is decided per row.
	 */
	const control = editing ? (
		<Input
			id={id}
			type={type}
			// The input only exists because the user just clicked this field;
			// not focusing it would mean clicking twice to type once.
			autoFocus
			value={draft}
			placeholder={placeholder}
			onChange={(event) => setDraft(event.target.value)}
			onBlur={commit}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					commit();
				}
				if (event.key === "Escape") {
					setDraft(value ?? "");
					setEditing(false);
				}
			}}
		/>
	) : (
		<Button
			variant="ghost"
			size="sm"
			className={CONTROL}
			onClick={() => {
				setDraft(value ?? "");
				setEditing(true);
			}}
		>
			{saving ? <Spinner /> : null}
			{shown ? (
				<span className={cn("truncate", sourced && SOURCED_VALUE)}>
					{render ? render(shown) : shown}
				</span>
			) : (
				<span className="truncate text-muted-foreground">
					{placeholder ?? <EmptyCellValue />}
				</span>
			)}
		</Button>
	);

	// The tooltip goes on the control the row already has, rather than a new
	// wrapper: pointing at a value explains it, tabbing to it does the same, and
	// nothing extra becomes clickable.
	const body =
		sourced && provenance ? (
			<SourcedValue source={provenance}>{control}</SourcedValue>
		) : (
			control
		);

	if (!suggestion) {
		return (
			<div className={ROW}>
				<label htmlFor={id} className={LABEL}>
					{label}
				</label>
				{body}
			</div>
		);
	}

	// A suggestion belongs to its field, so it sits under it in the value
	// column rather than becoming a row of its own that a reader has to
	// associate back to something.
	return (
		<div className={cn(ROW, "items-start")}>
			<label htmlFor={id} className={cn(LABEL, "pt-2")}>
				{label}
			</label>
			<div className="min-w-0">
				{body}
				{suggestion}
			</div>
		</div>
	);
}

/**
 * The same row, for a day chosen from a calendar.
 *
 * A date is the one property here that was never really text: typed, it wanted
 * `2026-12-31` and silently kept the old value for anything else, so the
 * placeholder had to teach the format. The picker is the same ghost control as
 * the select below it, and `""` means the rep cleared it.
 */
export function InlineDateField({
	label,
	value,
	onSave,
	saving = false,
	placeholder = "—",
	readOnly = false,
}: {
	label: string;
	/** An ISO timestamp or a day string; only the day is read. */
	value: string | null;
	onSave: (next: string) => void;
	saving?: boolean;
	placeholder?: string;
	readOnly?: boolean;
}) {
	const id = useId();

	if (readOnly) {
		const day = value?.slice(0, 10) ?? null;
		return (
			<div className={ROW}>
				<span className={LABEL}>{label}</span>
				<div className="min-w-0 px-2 text-sm">
					{day ? (
						<span className="truncate">{day}</span>
					) : (
						<span className="text-muted-foreground">{placeholder}</span>
					)}
				</div>
			</div>
		);
	}

	return (
		<div className={ROW}>
			<label htmlFor={id} className={LABEL}>
				{label}
			</label>
			<div className="flex min-w-0 items-center gap-1.5">
				<DatePicker
					id={id}
					variant="ghost"
					value={value?.slice(0, 10) ?? null}
					placeholder={placeholder}
					onChange={onSave}
				/>
				{saving ? <Spinner /> : null}
			</div>
		</div>
	);
}

/** The same row, for a value chosen from a list rather than typed. */
export function InlineSelectField({
	label,
	value,
	options,
	onSave,
	placeholder = "None",
	readOnly = false,
}: {
	label: string;
	value: string;
	options: { value: string; label: string }[];
	onSave: (next: string) => void;
	placeholder?: string;
	readOnly?: boolean;
}) {
	const id = useId();

	if (readOnly) {
		const selected = options.find((option) => option.value === value);
		return (
			<div className={ROW}>
				<span className={LABEL}>{label}</span>
				<div className="min-w-0 px-2 text-sm">
					{selected ? (
						<span className="truncate">{selected.label}</span>
					) : (
						<span className="text-muted-foreground">{placeholder}</span>
					)}
				</div>
			</div>
		);
	}

	return (
		<div className={ROW}>
			<label htmlFor={id} className={LABEL}>
				{label}
			</label>
			<Select value={value} onValueChange={onSave}>
				{/* `default` size, matching the text rows' 32px — a select that is a
				    pixel shorter than the field above it makes the column look bent. */}
				<SelectTrigger id={id} variant="ghost" className="w-full">
					<SelectValue placeholder={placeholder} />
				</SelectTrigger>
				<SelectContent>
					{options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
