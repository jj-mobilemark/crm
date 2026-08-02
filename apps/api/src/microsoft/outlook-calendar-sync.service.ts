import {
	ActivityType,
	type Db,
	GoogleSyncStatus,
	type MailboxSyncModel as MailboxSync,
	RecordSource,
} from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { ActivityStampService } from "../crm/activity-stamp.service";
import { InjectDatabase } from "../database/database.constants";
import type { Participant } from "../google/participants";
import { SyncStateService } from "../google/sync-state.service";
import {
	type MatchContext,
	MicrosoftMatchService,
} from "./microsoft-match.service";
import { MicrosoftTokenService } from "./microsoft-token.service";
import {
	conferenceUrl,
	eventTime,
	type GraphEvent,
	OutlookCalendarClient,
	originalStartTime,
} from "./outlook-calendar.client";

/** How many delta pages one cron tick will pull before yielding. */
const MAX_PAGES_PER_TICK = 5;

/** How far forward to look. Meetings matter before they happen. */
const HORIZON_DAYS = 180;

export type OutlookCalendarSyncOutcome = {
	source: "outlook-calendar";
	userId: string;
	status: "synced" | "skipped" | "reconnect" | "rate-limited" | "failed";
	eventsWritten?: number;
	eventsRemoved?: number;
	reason?: string;
};

/**
 * Outlook Calendar → `CalendarEvent` → a projected `Activity` on the timeline.
 *
 * The mechanical twin of `CalendarSyncService`. Graph's `calendarView/delta`
 * expands recurring series into instances, so `(iCalUId, originalStart)` keys a
 * row the same way `(iCalUID, originalStartTime)` does for Google.
 */
@Injectable()
export class OutlookCalendarSyncService {
	private readonly logger = new Logger(OutlookCalendarSyncService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly calendar: OutlookCalendarClient,
		private readonly tokens: MicrosoftTokenService,
		private readonly match: MicrosoftMatchService,
		private readonly state: SyncStateService,
		private readonly stamp: ActivityStampService,
		private readonly agent: AgentTriggerService,
	) {}

	async sync(row: MailboxSync): Promise<OutlookCalendarSyncOutcome> {
		const token = await this.tokens.accessTokenFor(
			row.userId,
			"outlook-calendar",
		);

		if (token.outcome === "not-connected") {
			return {
				source: "outlook-calendar",
				userId: row.userId,
				status: "skipped",
				reason: token.reason,
			};
		}

		if (token.outcome === "needs-reconnect") {
			await this.state.markNeedsReconnect(row.id, token.reason);
			return {
				source: "outlook-calendar",
				userId: row.userId,
				status: "reconnect",
				reason: token.reason,
			};
		}

		await this.state.markRunning(row.id);

		const [internal, suppressedDomains] = await Promise.all([
			this.match.internalIdentity(),
			this.match.suppressedDomains(),
		]);

		const context: MatchContext = {
			ourAddresses: internal.addresses,
			ourDomains: internal.domains,
			suppressedDomains,
		};

		const startDateTime = new Date().toISOString();
		const endDateTime = this.horizon().toISOString();

		let cursor = row.cursor ?? undefined;
		let written = 0;
		let removed = 0;

		for (let page = 0; page < MAX_PAGES_PER_TICK; page += 1) {
			const result = await this.calendar.listDelta(token.accessToken, {
				cursor,
				startDateTime,
				endDateTime,
			});

			if (result.outcome === "cursor-invalid") {
				await this.state.clearCursor(row.id, result.reason);
				return {
					source: "outlook-calendar",
					userId: row.userId,
					status: "synced",
					eventsWritten: written,
					eventsRemoved: removed,
					reason: "Cursor reset; the next tick re-runs the window.",
				};
			}

			if (result.outcome === "unauthorized") {
				await this.state.markNeedsReconnect(row.id, result.reason);
				return {
					source: "outlook-calendar",
					userId: row.userId,
					status: "reconnect",
					reason: result.reason,
				};
			}

			if (result.outcome === "rate-limited") {
				await this.state.markRateLimited(row.id, result.retryAfterMs);
				return {
					source: "outlook-calendar",
					userId: row.userId,
					status: "rate-limited",
					reason: result.reason,
				};
			}

			if (result.outcome === "failed") {
				await this.state.markFailed(row.id, result.reason);
				return {
					source: "outlook-calendar",
					userId: row.userId,
					status: "failed",
					reason: result.reason,
				};
			}

			for (const event of result.data.value ?? []) {
				const applied = await this.apply(event, row, context);
				if (applied === "written") written += 1;
				if (applied === "removed") removed += 1;
			}

			const next = result.data["@odata.nextLink"];
			const delta = result.data["@odata.deltaLink"];

			if (delta) {
				// The deltaLink only appears when the window is fully drained; that is
				// the signal steady-state can begin.
				await this.state.settle(row.id, {
					cursor: delta,
					status: GoogleSyncStatus.RUNNING,
				});

				this.logger.log({
					message: "Outlook calendar sync complete",
					userId: row.userId,
					eventsWritten: written,
					eventsRemoved: removed,
				});

				return {
					source: "outlook-calendar",
					userId: row.userId,
					status: "synced",
					eventsWritten: written,
					eventsRemoved: removed,
				};
			}

			if (!next) break;
			cursor = next;
		}

		// Ran out of page budget without a deltaLink, so there is nothing to keep.
		// The next tick re-runs the window, which is free because every write is an
		// upsert on a natural key.
		await this.state.settle(row.id, {
			status: GoogleSyncStatus.IDLE,
		});

		return {
			source: "outlook-calendar",
			userId: row.userId,
			status: "synced",
			eventsWritten: written,
			eventsRemoved: removed,
			reason: "Page budget reached; continuing next tick.",
		};
	}

	/**
	 * One event: store it, project it, or delete what we stored before.
	 *
	 * Returns what it did so the caller can count without a second pass.
	 */
	private async apply(
		event: GraphEvent,
		row: MailboxSync,
		context: MatchContext,
	): Promise<"written" | "removed" | "ignored"> {
		const iCalUid = event.iCalUId;
		if (!iCalUid) return "ignored";

		const start = eventTime(event.start, event.isAllDay);
		// An instance keeps its original start even when moved, which is what
		// identifies it within a recurring series.
		const originalStart = originalStartTime(event) ?? start?.at ?? null;

		if (!originalStart) return "ignored";

		// A cancellation arrives either as `@removed` on a delta page or as an
		// ordinary event with `isCancelled`.
		if (event["@removed"] || event.isCancelled) {
			const deleted = await this.db.calendarEvent.deleteMany({
				where: { iCalUid, originalStartTime: originalStart },
			});
			return deleted.count > 0 ? "removed" : "ignored";
		}

		const end = eventTime(event.end, event.isAllDay);
		if (!start || !end) return "ignored";

		const participants = this.participantsOf(event);

		// A meeting is two-way engagement on its own: somebody put time in a diary.
		// So calendar may create, subject to the row's own toggle — unless the
		// owner declined.
		const declinedByUs = event.responseStatus?.response === "declined";

		const match = await this.match.resolve(
			{
				participants,
				allowCreate: row.autoCreate && !declinedByUs,
				source: RecordSource.CALENDAR,
				ownerId: row.userId,
			},
			context,
		);

		if (!match.companyId && !match.contactId) {
			// Nothing we track, and nothing worth creating — a dentist appointment.
			// Never stored.
			return "ignored";
		}

		const organizer =
			event.organizer?.emailAddress?.address?.toLowerCase() ?? null;

		const record = await this.db.calendarEvent.upsert({
			where: {
				iCalUid_originalStartTime: {
					iCalUid,
					originalStartTime: originalStart,
				},
			},
			create: {
				iCalUid,
				originalStartTime: originalStart,
				recurringEventId: event.seriesMasterId ?? null,
				title: event.subject ?? null,
				description: event.bodyPreview ?? null,
				location: event.location?.displayName ?? null,
				conferenceUrl: conferenceUrl(event),
				startsAt: start.at,
				endsAt: end.at,
				isAllDay: start.isAllDay,
				status: event.isCancelled ? "cancelled" : "confirmed",
				organizerEmail: organizer,
				companyId: match.companyId,
				contactId: match.contactId,
				syncedByUserId: row.userId,
				outlookEventId: event.id ?? null,
			},
			update: {
				title: event.subject ?? null,
				description: event.bodyPreview ?? null,
				location: event.location?.displayName ?? null,
				conferenceUrl: conferenceUrl(event),
				startsAt: start.at,
				endsAt: end.at,
				isAllDay: start.isAllDay,
				status: event.isCancelled ? "cancelled" : "confirmed",
				organizerEmail: organizer,
				companyId: match.companyId,
				contactId: match.contactId,
			},
			select: { id: true },
		});

		await this.syncAttendees(record.id, event, organizer);
		await this.prepareForMeeting(record.id, start.at);
		await this.project(record.id, row.userId, {
			title: event.subject ?? "Meeting",
			startsAt: start.at,
			companyId: match.companyId,
			contactId: match.contactId,
			location: event.location?.displayName ?? null,
		});

		return "written";
	}

	/** Replaces the attendee list, linking anyone we already know as a contact. */
	private async syncAttendees(
		eventId: string,
		event: GraphEvent,
		organizerEmail: string | null,
	): Promise<void> {
		// Flattened to a clean shape up front: Graph nests the address inside
		// `emailAddress`, and meeting rooms are attendees as far as Graph is
		// concerned. Filtering here means the rest of the method never touches an
		// optional address.
		const attendees = (event.attendees ?? []).flatMap((attendee) => {
			const email = attendee.emailAddress?.address?.toLowerCase();
			if (!email || attendee.type === "resource") return [];
			return [
				{
					email,
					name: attendee.emailAddress?.name ?? null,
					responseStatus: attendee.status?.response ?? null,
				},
			];
		});

		if (attendees.length === 0) return;

		const contacts = await this.db.contact.findMany({
			where: { email: { in: attendees.map((attendee) => attendee.email) } },
			select: { id: true, email: true },
		});

		const contactByEmail = new Map(
			contacts.map((contact) => [contact.email as string, contact.id]),
		);

		for (const attendee of attendees) {
			const { email } = attendee;

			await this.db.calendarAttendee.upsert({
				where: { eventId_email: { eventId, email } },
				create: {
					eventId,
					email,
					name: attendee.name,
					responseStatus: attendee.responseStatus,
					// Graph does not flag the organiser inside `attendees`, so we
					// derive it by matching the event's organiser address.
					isOrganizer: email === organizerEmail,
					contactId: contactByEmail.get(email) ?? null,
				},
				update: {
					name: attendee.name,
					responseStatus: attendee.responseStatus,
					isOrganizer: email === organizerEmail,
					contactId: contactByEmail.get(email) ?? null,
				},
			});
		}
	}

	/**
	 * Tells the agent about people we are about to meet and do not know.
	 *
	 * The most useful thing the calendar knows is that a conversation is
	 * *coming*. A contact with no background, on a meeting tomorrow, is worth
	 * more research than on any other day — and the deadline is real, so it goes
	 * to the front of the queue. Only for meetings actually ahead of us.
	 */
	private async prepareForMeeting(
		eventId: string,
		startsAt: Date,
	): Promise<void> {
		const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
		if (startsAt <= new Date() || startsAt > soon) return;

		const attendees = await this.db.calendarAttendee.findMany({
			where: {
				eventId,
				contactId: { not: null },
				// Whoever is taking the meeting is not who needs researching.
				contact: { brief: { is: null } },
			},
			select: { contactId: true },
		});

		for (const attendee of attendees) {
			if (attendee.contactId) {
				await this.agent.meetingSoon(attendee.contactId, startsAt);
			}
		}
	}

	/**
	 * The timeline projection: one `Activity` per event, kept current.
	 *
	 * `occurredAt` is the meeting's start even when in the future, so an upcoming
	 * meeting sorts where a rep expects to find it.
	 */
	private async project(
		calendarEventId: string,
		userId: string,
		summary: {
			title: string;
			startsAt: Date;
			companyId: string | null;
			contactId: string | null;
			location: string | null;
		},
	): Promise<void> {
		const body = summary.location ? `Location: ${summary.location}` : null;

		const activity = await this.db.activity.upsert({
			where: { calendarEventId },
			create: {
				type: ActivityType.MEETING,
				subject: summary.title,
				body,
				occurredAt: summary.startsAt,
				companyId: summary.companyId,
				contactId: summary.contactId,
				createdById: userId,
				calendarEventId,
				meta: { synced: true, source: "outlook-calendar" },
			},
			update: {
				subject: summary.title,
				body,
				occurredAt: summary.startsAt,
				companyId: summary.companyId,
				contactId: summary.contactId,
			},
			select: { createdAt: true },
		});

		await this.stamp.touch(
			{ companyId: summary.companyId, contactId: summary.contactId },
			activity.createdAt,
		);
	}

	private participantsOf(event: GraphEvent): Participant[] {
		const people: Participant[] = [];

		for (const attendee of event.attendees ?? []) {
			const email = attendee.emailAddress?.address;
			if (!email || attendee.type === "resource") continue;
			people.push({
				email: email.toLowerCase(),
				name: attendee.emailAddress?.name ?? null,
			});
		}

		// A one-to-one booked through a scheduling link often has the customer as
		// organiser and nobody in `attendees`.
		if (event.organizer?.emailAddress?.address) {
			people.push({
				email: event.organizer.emailAddress.address.toLowerCase(),
				name: event.organizer.emailAddress.name ?? null,
			});
		}

		return people;
	}

	private horizon(): Date {
		const to = new Date();
		to.setDate(to.getDate() + HORIZON_DAYS);
		return to;
	}
}
