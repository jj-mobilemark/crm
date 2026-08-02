import type { Db } from "@crm/db";
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

/**
 * Reading a synced thread or event back out.
 *
 * Separate from the sync services because this is the only path that returns
 * message bodies, and keeping it in one file makes "where can an email body
 * reach the browser" a question with one answer. The timeline never calls it —
 * it carries a snippet, and the accordion fetches this on expand.
 */
@Injectable()
export class ConversationService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async thread(threadId: string) {
		const thread = await this.db.emailThread.findUnique({
			where: { id: threadId },
			select: {
				id: true,
				subject: true,
				messageCount: true,
				firstMessageAt: true,
				lastMessageAt: true,
				company: { select: { id: true, name: true } },
				contact: { select: { id: true, firstName: true, lastName: true } },
				messages: {
					orderBy: { sentAt: "asc" },
					select: {
						id: true,
						direction: true,
						fromEmail: true,
						fromName: true,
						recipients: true,
						subject: true,
						body: true,
						snippet: true,
						sentAt: true,
						gmailMessageId: true,
						outlookMessageId: true,
					},
				},
			},
		});

		if (!thread) {
			throw new NotFoundException(`No email thread with id ${threadId}.`);
		}

		return {
			...thread,
			firstMessageAt: thread.firstMessageAt.toISOString(),
			lastMessageAt: thread.lastMessageAt.toISOString(),
			messages: thread.messages.map((message) => ({
				...message,
				sentAt: message.sentAt.toISOString(),
				recipients: recipientsOf(message.recipients),
				/** Deep link back to Gmail, when we know which message it was. */
				gmailUrl: message.gmailMessageId
					? `https://mail.google.com/mail/u/0/#all/${message.gmailMessageId}`
					: null,
				/** Deep link back to Outlook, when we know which message it was. */
				outlookUrl: message.outlookMessageId
					? `https://outlook.office.com/mail/deeplink/read/${message.outlookMessageId}`
					: null,
			})),
		};
	}

	async event(eventId: string) {
		const event = await this.db.calendarEvent.findUnique({
			where: { id: eventId },
			select: {
				id: true,
				title: true,
				description: true,
				location: true,
				conferenceUrl: true,
				startsAt: true,
				endsAt: true,
				isAllDay: true,
				status: true,
				organizerEmail: true,
				company: { select: { id: true, name: true } },
				contact: { select: { id: true, firstName: true, lastName: true } },
				attendees: {
					orderBy: [{ isOrganizer: "desc" }, { email: "asc" }],
					select: {
						id: true,
						email: true,
						name: true,
						responseStatus: true,
						isOrganizer: true,
						contactId: true,
					},
				},
			},
		});

		if (!event) {
			throw new NotFoundException(`No calendar event with id ${eventId}.`);
		}

		return {
			...event,
			startsAt: event.startsAt.toISOString(),
			endsAt: event.endsAt.toISOString(),
		};
	}
}

/** `recipients` is `Json`, so it is read back defensively. */
function recipientsOf(
	value: unknown,
): { email: string; name: string | null; kind: string }[] {
	if (!Array.isArray(value)) return [];

	return value.flatMap((entry) => {
		if (typeof entry !== "object" || entry === null) return [];
		const record = entry as Record<string, unknown>;
		if (typeof record.email !== "string") return [];

		return [
			{
				email: record.email,
				name: typeof record.name === "string" ? record.name : null,
				kind: typeof record.kind === "string" ? record.kind : "to",
			},
		];
	});
}
