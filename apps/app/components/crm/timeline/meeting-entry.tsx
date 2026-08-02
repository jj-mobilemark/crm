"use client";

import { AttendeeList } from "@crm/ui/components/attendee-list";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc/client";

const rangeFormat = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
});

const timeOnly = new Intl.DateTimeFormat(undefined, {
	hour: "numeric",
	minute: "2-digit",
});

const dayOnly = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
});

/**
 * A synced calendar event on the timeline.
 *
 * The attendee list is fetched lazily for the same reason the thread is: the
 * timeline row carries a count, and pulling every attendee of every meeting on
 * a busy company would be a join per row for information most rows never show.
 */
export function MeetingEntry({
	eventId,
	startsAt,
	endsAt,
	isAllDay,
	attendeeCount,
	conferenceUrl,
	provider = "google",
}: {
	eventId: string;
	startsAt: string;
	endsAt: string;
	isAllDay: boolean;
	attendeeCount: number;
	conferenceUrl: string | null;
	provider?: "google" | "microsoft";
}) {
	const trpc = useTRPC();

	// Only worth a request when there is somebody to show.
	const googleEvent = useQuery({
		...trpc.google.event.queryOptions({ eventId }),
		enabled: attendeeCount > 0 && provider === "google",
	});

	const microsoftEvent = useQuery({
		...trpc.microsoft.event.queryOptions({ eventId }),
		enabled: attendeeCount > 0 && provider === "microsoft",
	});

	const event = provider === "microsoft" ? microsoftEvent : googleEvent;

	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
			<span className="text-muted-foreground text-xs">
				{formatRange(startsAt, endsAt, isAllDay)}
			</span>

			{event.data?.attendees && event.data.attendees.length > 0 ? (
				<AttendeeList attendees={event.data.attendees} />
			) : null}

			{conferenceUrl ? (
				<a
					href={conferenceUrl}
					target="_blank"
					rel="noreferrer"
					className="text-muted-foreground text-xs underline underline-offset-3 hover:text-foreground"
				>
					Join call
				</a>
			) : null}
		</div>
	);
}

/**
 * "5 Aug, 14:00 – 15:00", collapsing the second date when it is the same day —
 * which it almost always is, and repeating it reads like a two-day meeting.
 */
function formatRange(
	startsAt: string,
	endsAt: string,
	isAllDay: boolean,
): string {
	const start = new Date(startsAt);
	const end = new Date(endsAt);

	if (isAllDay) return `${dayOnly.format(start)} · All day`;

	const sameDay = start.toDateString() === end.toDateString();

	return sameDay
		? `${rangeFormat.format(start)} – ${timeOnly.format(end)}`
		: `${rangeFormat.format(start)} – ${rangeFormat.format(end)}`;
}
