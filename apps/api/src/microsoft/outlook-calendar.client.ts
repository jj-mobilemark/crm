import { Injectable } from "@nestjs/common";
import { GraphApiClient, type GraphResult } from "./graph-api.client";
import type { GraphEmailAddress } from "./outlook-mail.client";

const BASE = "https://graph.microsoft.com/v1.0";

/** A Graph date-time: a naive wall-clock string plus the zone it is in. */
export type GraphDateTime = {
	dateTime?: string;
	timeZone?: string;
};

/** The slice of a Graph `event` resource we ask for and read. */
export type GraphEvent = {
	id?: string;
	iCalUId?: string;
	subject?: string;
	body?: { contentType?: string; content?: string };
	bodyPreview?: string;
	location?: { displayName?: string };
	start?: GraphDateTime;
	end?: GraphDateTime;
	isAllDay?: boolean;
	isCancelled?: boolean;
	organizer?: { emailAddress?: GraphEmailAddress };
	attendees?: {
		emailAddress?: GraphEmailAddress;
		status?: { response?: string };
		type?: string;
	}[];
	onlineMeeting?: { joinUrl?: string };
	webLink?: string;
	seriesMasterId?: string;
	/** An expanded instance keeps its series start here — a datetimeoffset. */
	originalStart?: string;
	type?: string;
	/** The calendar owner's own response to the event. */
	responseStatus?: { response?: string };
	/** Present on a delta page when the event was cancelled/deleted. */
	"@removed"?: { reason?: string };
};

/** A page of a calendar delta query. */
export type CalendarDeltaPage = {
	value?: GraphEvent[];
	"@odata.nextLink"?: string;
	"@odata.deltaLink"?: string;
};

const EVENT_SELECT = [
	"id",
	"iCalUId",
	"subject",
	"body",
	"bodyPreview",
	"location",
	"start",
	"end",
	"isAllDay",
	"isCancelled",
	"organizer",
	"attendees",
	"onlineMeeting",
	"webLink",
	"seriesMasterId",
	"originalStart",
	"type",
	"responseStatus",
].join(",");

@Injectable()
export class OutlookCalendarClient {
	constructor(private readonly api: GraphApiClient) {}

	/**
	 * One page of the calendar-view delta.
	 *
	 * `calendarView/delta` expands recurring series into instances, which is what
	 * makes `(iCalUId, originalStart)` a usable key. With a `cursor` it follows
	 * the returned link as-is; the time window is baked into that link, so it is
	 * only sent on the first call.
	 *
	 * The `Prefer: outlook.timezone="UTC"` header makes Graph return every
	 * `start`/`end` in UTC, so the naive `dateTime` string can be read as UTC
	 * without carrying each event's own zone through to the parser.
	 */
	async listDelta(
		accessToken: string,
		options: { cursor?: string; startDateTime: string; endDateTime: string },
	): Promise<GraphResult<CalendarDeltaPage>> {
		const preferUtc = { prefer: 'outlook.timezone="UTC"' };

		if (options.cursor) {
			return this.api.get<CalendarDeltaPage>(
				options.cursor,
				accessToken,
				{},
				preferUtc,
			);
		}

		return this.api.get<CalendarDeltaPage>(
			`${BASE}/me/calendarView/delta`,
			accessToken,
			{
				startDateTime: options.startDateTime,
				endDateTime: options.endDateTime,
				$select: EVENT_SELECT,
			},
			preferUtc,
		);
	}
}

/** The best conference link on an event, if it has one. */
export function conferenceUrl(event: GraphEvent): string | null {
	return event.onlineMeeting?.joinUrl ?? null;
}

/**
 * A Graph event time as a Date, plus whether the event is all-day.
 *
 * The client asks Graph for UTC, so a timed `dateTime` with no offset is read
 * as UTC. An all-day event's `dateTime` is a bare midnight in its own zone; the
 * date part is parsed as UTC midnight so the key stays stable wherever the
 * server runs.
 */
export function eventTime(
	time: GraphDateTime | undefined,
	isAllDay: boolean | undefined,
): { at: Date; isAllDay: boolean } | null {
	if (!time?.dateTime) return null;

	if (isAllDay) {
		const datePart = time.dateTime.slice(0, 10);
		const at = new Date(`${datePart}T00:00:00Z`);
		return Number.isNaN(at.getTime()) ? null : { at, isAllDay: true };
	}

	// Graph returns UTC (we ask for it) with no trailing `Z`; add one unless an
	// explicit offset is already present.
	const raw = time.dateTime;
	const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/.test(raw);
	const at = new Date(hasOffset ? raw : `${raw}Z`);
	return Number.isNaN(at.getTime()) ? null : { at, isAllDay: false };
}

/** An expanded instance's `originalStart` (a plain datetimeoffset string). */
export function originalStartTime(event: GraphEvent): Date | null {
	if (!event.originalStart) return null;
	const raw = event.originalStart;
	const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/.test(raw);
	const at = new Date(hasOffset ? raw : `${raw}Z`);
	return Number.isNaN(at.getTime()) ? null : at;
}
