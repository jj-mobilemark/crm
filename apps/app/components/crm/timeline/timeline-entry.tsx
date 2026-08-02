"use client";

import { Checkbox } from "@crm/ui/components/checkbox";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { relativeTimeFromIso } from "@crm/ui/lib/format";
import { cn } from "@crm/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { dealStageLabel } from "@/components/crm/deal-stage";
import { RecordLink } from "@/components/crm/record-sheet/record-link";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { ActivityIcon, activityLabel } from "./activity-icon";
import { EmailThreadEntry } from "./email-thread-entry";
import { MeetingEntry } from "./meeting-entry";
import type { TimelineAnchor } from "./timeline";

export type TimelineEntryData =
	RouterOutputs["activities"]["timeline"]["entries"][number];

const timeFormat = new Intl.DateTimeFormat(undefined, {
	hour: "numeric",
	minute: "2-digit",
});

/** `{ from, to }` on a STAGE_CHANGE, read back defensively — it is `Json`. */
function stageChange(meta: Record<string, unknown> | null) {
	const from = typeof meta?.from === "string" ? meta.from : null;
	const to = typeof meta?.to === "string" ? meta.to : null;
	return from && to ? { from, to } : null;
}

/** The record this timeline is already about, whichever kind it is. */
function anchorId(anchor: TimelineAnchor): string {
	if ("companyId" in anchor) return anchor.companyId;
	if ("contactId" in anchor) return anchor.contactId;
	return anchor.dealId;
}

/**
 * One thing that happened.
 *
 * Two rules decide the layout, and both came from the same mistake — treating
 * the *type* of an entry as its headline.
 *
 * **The content is whatever there is.** A synced meeting has a title and no
 * body; a logged note has a body and no title; an enrichment has both. When
 * there was a title it was set in medium foreground and the body underneath in
 * muted grey, which was right — and when there was not, the word "Email" got
 * promoted into the title slot and the thing you actually wrote was demoted to
 * grey small print beneath it. The row read "Email / Test" with the wrong half
 * emphasised. Now the first line of real content is the headline, and the type
 * is carried by the icon in the gutter, which was already there saying it.
 *
 * **Who and when go right, and cross-references only point elsewhere.** Every
 * row on a contact's timeline used to end with a link to that contact — six
 * copies of the name at the top of the panel. A chip is worth a line only when
 * it goes somewhere you are not.
 */
export function TimelineEntry({
	entry,
	anchor,
}: {
	entry: TimelineEntryData;
	anchor: TimelineAnchor;
}) {
	const trpc = useTRPC();
	const cache = useCrmCache();

	const complete = useMutation(
		trpc.activities.complete.mutationOptions({
			onSuccess: () => cache.activity(),
			onError: (error) => toast.error(error.message),
		}),
	);

	const isTask = entry.type === "TASK";
	const done = entry.completedAt !== null;
	const overdue =
		isTask &&
		!done &&
		entry.dueAt !== null &&
		new Date(entry.dueAt) < new Date();

	const change = entry.type === "STAGE_CHANGE" ? stageChange(entry.meta) : null;
	const when = entry.occurredAt ?? entry.createdAt;

	// A synced entry was not written by the person whose mailbox it came from,
	// so it is attributed to the source rather than to them.
	const synced = entry.meta?.synced === true;
	const syncSource =
		typeof entry.meta?.source === "string" ? entry.meta.source : null;
	const mailboxProvider =
		syncSource === "outlook" || syncSource === "outlook-calendar"
			? "microsoft"
			: "google";
	const author = synced
		? entry.emailThread
			? "via Gmail"
			: "via Calendar"
		: entry.createdBy.name;

	const headline = change
		? `${dealStageLabel(change.from as never)} → ${dealStageLabel(change.to as never)}`
		: entry.subject;

	// Only when they are somewhere else. On a deal's timeline the deal is the
	// page; on a contact's, the contact is.
	const here = anchorId(anchor);
	const deal = entry.deal && entry.deal.id !== here ? entry.deal : null;
	const contact =
		entry.contact && entry.contact.id !== here ? entry.contact : null;

	const footnotes = Boolean(
		deal || contact || (isTask && !done && entry.dueAt),
	);

	return (
		<li className="flex gap-2.5 py-2">
			<span className="mt-0.5 shrink-0 text-muted-foreground">
				{isTask ? (
					<Checkbox
						checked={done}
						disabled={complete.isPending}
						aria-label={done ? "Mark as not done" : "Mark as done"}
						onCheckedChange={(checked) =>
							complete.mutate({ id: entry.id, completed: checked === true })
						}
					/>
				) : (
					<span role="img" aria-label={activityLabel(entry.type)}>
						<ActivityIcon type={entry.type} />
					</span>
				)}
			</span>

			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex min-w-0 items-baseline gap-3">
					<div className="min-w-0 flex-1 space-y-0.5">
						{headline ? (
							<p
								className={cn(
									"wrap-anywhere font-medium",
									done && "text-muted-foreground line-through",
								)}
							>
								{headline}
							</p>
						) : null}

						{entry.body ? (
							<p
								className={cn(
									"whitespace-pre-wrap text-pretty wrap-anywhere",
									headline && "text-muted-foreground",
								)}
							>
								{entry.body}
							</p>
						) : null}

						{/* Something has to be on the line. A stage change and a bare
						    logged call both arrive with nothing written on them. */}
						{!headline && !entry.body ? (
							<p className="text-muted-foreground">
								{activityLabel(entry.type)}
							</p>
						) : null}
					</div>

					{/*
					 * Who and when, together, on the right. A line of their own would
					 * cost every note in the panel a second row to carry one short
					 * grey string — most entries are a sentence and a signature, and
					 * they should be one line.
					 */}
					<span className="shrink-0 text-muted-foreground">
						<span className="hidden sm:inline">{author} · </span>
						<span className="tabular-nums">
							{timeFormat.format(new Date(when))}
						</span>
					</span>
				</div>

				{entry.calendarEvent ? (
					<MeetingEntry
						eventId={entry.calendarEvent.id}
						startsAt={entry.calendarEvent.startsAt}
						endsAt={entry.calendarEvent.endsAt}
						isAllDay={entry.calendarEvent.isAllDay}
						attendeeCount={entry.calendarEvent.attendeeCount}
						conferenceUrl={entry.calendarEvent.conferenceUrl}
						provider={mailboxProvider}
					/>
				) : null}

				{entry.emailThread ? (
					<EmailThreadEntry
						threadId={entry.emailThread.id}
						messageCount={entry.emailThread.messageCount}
						provider={mailboxProvider}
					/>
				) : null}

				{/*
				 * The footnotes: when it is due, and where else it belongs. Rendered
				 * only when there is one — an entry with neither should not pay a
				 * line for the possibility.
				 */}
				{footnotes ? (
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
						{overdue ? (
							<StatusIndicator
								tone="error"
								label={`Overdue ${relativeTimeFromIso(entry.dueAt)}`}
							/>
						) : isTask && !done && entry.dueAt ? (
							<StatusIndicator
								tone="info"
								label={`Due ${relativeTimeFromIso(entry.dueAt)}`}
							/>
						) : null}

						{deal ? (
							<RecordLink kind="deal" id={deal.id}>
								{deal.name}
							</RecordLink>
						) : null}

						{contact ? (
							<RecordLink kind="contact" id={contact.id}>
								{[contact.firstName, contact.lastName]
									.filter(Boolean)
									.join(" ")}
							</RecordLink>
						) : null}
					</div>
				) : null}
			</div>
		</li>
	);
}
