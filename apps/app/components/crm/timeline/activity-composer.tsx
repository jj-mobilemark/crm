"use client";

import Calendar from "@carbon/icons-react/es/Calendar";
// The shadcn calendar, aliased so it does not collide with the Carbon glyph on
// the button that opens it.
import { Calendar as DayPicker } from "@crm/ui/components/calendar";
import { Icon } from "@crm/ui/components/icon";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from "@crm/ui/components/input-group";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@crm/ui/components/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { Spinner } from "@crm/ui/components/spinner";
import { ToggleGroup, ToggleGroupItem } from "@crm/ui/components/toggle-group";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
	PRIORITY_NONE,
	PRIORITY_OPTIONS,
	type PriorityValue,
	priorityLabel,
} from "@/components/crm/priority";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import { ActivityIcon, activityLabel } from "./activity-icon";
import type { TimelineAnchor } from "./timeline";

/** Only what a person can log. Stage changes and enrichment write themselves,
 * and the API's create input refuses the other two for the same reason. */
const TYPES = ["NOTE", "CALL", "EMAIL", "MEETING", "TASK"] as const;

type ComposableType = (typeof TYPES)[number];

const dueFormat = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
});

const PLACEHOLDER: Record<ComposableType, string> = {
	NOTE: "Log a note, call, email, meeting or task…",
	CALL: "What came out of the call?",
	EMAIL: "What was said?",
	MEETING: "What came out of the meeting?",
	TASK: "What needs doing?",
};

/**
 * Logging what just happened: one box, and a toolbar inside it.
 *
 * Two rewrites got here, and both of the things it replaced are worth naming.
 *
 * It began as a button that swapped itself for a form — so reading the timeline
 * cost a click, and the state you were left in *after* logging one note was the
 * state that pushed the history off the fold. Then it lost the mode but kept
 * the shape: a bordered textarea, a bordered row of five type buttons, and a
 * bordered row of six filters underneath, three stacked bands of outlined boxes
 * for a panel whose actual job is to be read.
 *
 * This is one bordered element. The type toggles live *inside* the box, under a
 * rule, the way a formatting toolbar does — which is also what stops them
 * reading as a second copy of the filter row directly below, since that one is
 * borderless and outside. The submit button is always there and always in the
 * same place; nothing appears or disappears as you type, so nothing jumps.
 *
 * **There is no subject field.** It was optional on three types, load-bearing
 * on one, and the source of most of the branching in here — the old form asked
 * a different question per type and then disagreed with itself about which
 * answer made the button live. The box you type in is the entry: a task's title
 * or everything else's body. A logged call with no title reads "Call" on the
 * timeline, which is true, and the note under it is the part anyone reads.
 *
 * The draft stays in `useState`, which is the one piece of this panel that
 * belongs there — `record-stack` keeps the rest in the URL, and a half-written
 * note about a customer has no business in browser history.
 */
export function ActivityComposer({ anchor }: { anchor: TimelineAnchor }) {
	const trpc = useTRPC();
	const cache = useCrmCache();

	const [type, setType] = useState<ComposableType>("NOTE");
	const [draft, setDraft] = useState("");
	const [dueAt, setDueAt] = useState<Date | undefined>(undefined);
	const [priority, setPriority] = useState<string>(PRIORITY_NONE);

	const isTask = type === "TASK";
	const text = draft.trim();

	const reset = () => {
		setDraft("");
		setDueAt(undefined);
		setPriority(PRIORITY_NONE);
	};

	const create = useMutation(
		trpc.activities.create.mutationOptions({
			onSuccess: async () => {
				await cache.activity();
				reset();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const submit = () => {
		if (text === "" || create.isPending) return;
		create.mutate({
			...anchor,
			type,
			subject: isTask ? text : undefined,
			body: isTask ? undefined : text,
			dueAt: isTask ? (dueAt?.toISOString() ?? null) : undefined,
			priority: isTask
				? priority === PRIORITY_NONE
					? null
					: (priority as PriorityValue)
				: undefined,
		});
	};

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<InputGroup>
				<InputGroupTextarea
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					placeholder={PLACEHOLDER[type]}
					aria-label="What happened"
					onKeyDown={(event) => {
						// Plain Enter has to stay a newline — this is where a three
						// paragraph call note goes.
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
							event.preventDefault();
							submit();
						}
						if (event.key === "Escape") reset();
					}}
				/>

				<InputGroupAddon align="block-end" className="gap-2 border-t">
					{/*
					 * Borderless and inside the box. The filter row below is the same
					 * control with the same shape, and the only reason the two do not
					 * read as one confused pair of duplicates is that this one sits
					 * under a rule inside a bordered container and that one does not.
					 */}
					<ToggleGroup
						type="single"
						value={type}
						onValueChange={(next) => next && setType(next as ComposableType)}
						size="sm"
						spacing={0}
					>
						{TYPES.map((option) => (
							<ToggleGroupItem
								key={option}
								value={option}
								aria-label={activityLabel(option)}
							>
								<ActivityIcon type={option} />
								{activityLabel(option)}
							</ToggleGroupItem>
						))}
					</ToggleGroup>

					{/*
					 * A task is the one thing here with a future, so it is the one
					 * thing that gets a date — and it gets a real calendar rather than
					 * `<input type="date">`, whose picker is drawn by the browser and
					 * knows nothing about any of these tokens.
					 */}
					{isTask ? (
						<>
							<Popover>
								<PopoverTrigger asChild>
									<InputGroupButton variant="ghost" size="xs">
										<Icon icon={Calendar} data-icon="inline-start" />
										{dueAt ? dueFormat.format(dueAt) : "Due date"}
									</InputGroupButton>
								</PopoverTrigger>
								<PopoverContent size="fit" align="start">
									<DayPicker
										mode="single"
										selected={dueAt}
										onSelect={setDueAt}
										autoFocus
									/>
								</PopoverContent>
							</Popover>

							<Select value={priority} onValueChange={setPriority}>
								<SelectTrigger
									variant="ghost"
									size="sm"
									className="h-7 w-auto gap-1 border-0 px-2 text-xs shadow-none"
									aria-label="Priority"
								>
									<SelectValue>
										{priorityLabel(
											priority === PRIORITY_NONE
												? null
												: (priority as PriorityValue),
										)}
									</SelectValue>
								</SelectTrigger>
								<SelectContent>
									{PRIORITY_OPTIONS.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</>
					) : null}

					{/*
					 * Only once there is something to submit. `--primary` in dark mode
					 * is near-white, so a permanently-present disabled primary button
					 * is a grey slab sitting in the corner of an empty box — it made
					 * the whole composer read as switched off. It appears at the end of
					 * a row that is already there, so nothing reflows around it.
					 */}
					{text === "" ? null : (
						<InputGroupButton
							type="submit"
							variant="default"
							size="xs"
							className="ml-auto"
							disabled={create.isPending}
						>
							{create.isPending ? <Spinner /> : null}
							{isTask ? "Add task" : `Log ${activityLabel(type).toLowerCase()}`}
						</InputGroupButton>
					)}
				</InputGroupAddon>
			</InputGroup>
		</form>
	);
}
