/**
 * Turning a Graph message resource into something readable.
 *
 * Graph hands us JSON, not MIME, so there is no base64 or multipart to unpick —
 * but the RFC identity still lives in the internet headers, and a reply still
 * carries the whole conversation in its body. Both of those are shared with
 * Gmail, so the header logic and the quote-stripping come from `../google/mime`
 * rather than being copied.
 */
import {
	normaliseMessageId,
	rootMessageId,
	stripHtml,
	stripQuotedHistory,
} from "../google/mime";
import type { Participant } from "../google/participants";
import type { GraphEmailAddress, GraphMessage } from "./outlook-mail.client";

/** A Graph message parsed into the shape the database wants. */
export type ParsedMessage = {
	rfcMessageId: string;
	rootId: string;
	subject: string | null;
	from: Participant;
	recipients: { email: string; name: string | null; kind: "to" | "cc" }[];
	body: string;
	sentAt: Date;
	outlookMessageId: string | null;
};

/** One Graph `emailAddress` object into a participant, or null if unusable. */
function participantOf(
	address: GraphEmailAddress | undefined,
): Participant | null {
	const email = address?.address?.trim().toLowerCase();
	if (!email || !isEmailish(email)) return null;

	const name = address?.name?.trim();
	return { email, name: name || null };
}

/**
 * Graph's message resource → the fields we store, or null if it cannot be
 * keyed or attributed.
 *
 * `internetMessageId` is the RFC id, present on any real mail. The reply root
 * comes from the internet headers, which Graph returns in the same
 * `{ name, value }` shape Gmail uses — so `rootMessageId` reads them directly.
 */
export function parseGraphMessage(message: GraphMessage): ParsedMessage | null {
	const rawMessageId = message.internetMessageId?.trim();
	if (!rawMessageId) return null;

	const from = participantOf(message.from?.emailAddress);
	if (!from) return null;

	const sentAt = sentAtOf(message);
	if (!sentAt) return null;

	const headers = message.internetMessageHeaders;
	const rootId = rootMessageId(headers) ?? normaliseMessageId(rawMessageId);

	const to = recipients(message.toRecipients, "to");
	const cc = recipients(message.ccRecipients, "cc");

	return {
		rfcMessageId: normaliseMessageId(rawMessageId),
		rootId,
		subject: message.subject?.trim() || null,
		from,
		recipients: [...to, ...cc],
		body: bodyOf(message),
		sentAt,
		outlookMessageId: message.id ?? null,
	};
}

function recipients(
	list: GraphMessage["toRecipients"],
	kind: "to" | "cc",
): { email: string; name: string | null; kind: "to" | "cc" }[] {
	const seen = new Set<string>();
	const out: { email: string; name: string | null; kind: "to" | "cc" }[] = [];

	for (const entry of list ?? []) {
		const participant = participantOf(entry.emailAddress);
		if (!participant || seen.has(participant.email)) continue;
		seen.add(participant.email);
		out.push({ email: participant.email, name: participant.name, kind });
	}

	return out;
}

/**
 * The plain-text body, quotes trimmed.
 *
 * Graph tells us the content type, so we strip HTML only when it says HTML.
 * Falls back to the preview when the body is empty, because "(no body)" on the
 * timeline is useless.
 */
function bodyOf(message: GraphMessage): string {
	const raw = message.body?.content ?? "";
	const text =
		message.body?.contentType?.toLowerCase() === "html" ? stripHtml(raw) : raw;

	const stripped = stripQuotedHistory(text);
	return stripped || (message.bodyPreview?.trim() ?? "");
}

function sentAtOf(message: GraphMessage): Date | null {
	// `receivedDateTime` is Graph's own receipt time and is always present and
	// parseable; `sentDateTime` is the backstop.
	const raw = message.receivedDateTime ?? message.sentDateTime;
	if (!raw) return null;

	const at = new Date(raw);
	return Number.isNaN(at.getTime()) ? null : at;
}

function isEmailish(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
