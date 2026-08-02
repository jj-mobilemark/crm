import { db } from "@crm/db";

/**
 * The rep's own recent mail and open pipeline — what the daily sweep reads
 * before it proposes anything.
 *
 * Straight to Postgres through `@crm/db`, the same as every other read in this
 * agent (see `crm.ts`). Message bodies are included for the same reason they
 * are in `readCrmHistory`: this is a single-tenant internal tool reading its
 * own mailbox, and the boundary is egress, not access.
 */

export type MailboxMessage = {
	id: string;
	threadId: string;
	direction: string;
	fromEmail: string;
	fromName: string | null;
	subject: string | null;
	sentAt: string;
	/** Plain text, quote-stripped. Never a full HTML body. */
	body: string | null;
	contactId: string | null;
	companyId: string | null;
};

export type OpenDeal = {
	id: string;
	name: string;
	companyId: string;
	companyName: string;
	stage: string;
	stageChangedAt: string;
	lastActivityAt: string | null;
	/** Null when there has never been any activity to measure from. */
	daysSinceActivity: number | null;
	contacts: { id: string; name: string }[];
};

/** A suggestion already outstanding, so the agent does not propose it twice. */
export type OpenSuggestion = {
	kind: string;
	contactId: string | null;
	companyId: string | null;
	dealId: string | null;
};

export type RepFollowupContext = {
	rep: { id: string; name: string | null };
	messages: MailboxMessage[];
	openDeals: OpenDeal[];
	alreadyProposed: OpenSuggestion[];
};

/**
 * Everything the daily sweep needs about one rep, in one call.
 *
 * `messages` comes from `syncedByUserId` — mail this rep's own mailbox
 * produced, not every message a contact of theirs happens to be on. `openDeals`
 * orders the stalest first, because a deal nobody has touched in weeks is
 * exactly what this sweep exists to surface.
 */
export async function repFollowupContext(
	userId: string,
	options: { messages?: number } = {},
): Promise<RepFollowupContext | null> {
	const rep = await db.user.findUnique({
		where: { id: userId },
		select: { id: true, name: true },
	});

	if (!rep) return null;

	const [messages, deals, proposed] = await Promise.all([
		db.emailMessage.findMany({
			where: { syncedByUserId: userId },
			orderBy: { sentAt: "desc" },
			take: options.messages ?? 40,
			select: {
				id: true,
				threadId: true,
				direction: true,
				fromEmail: true,
				fromName: true,
				subject: true,
				sentAt: true,
				body: true,
				snippet: true,
				thread: { select: { contactId: true, companyId: true } },
			},
		}),
		db.deal.findMany({
			where: { ownerId: userId, closedAt: null },
			orderBy: [{ lastActivityAt: { sort: "asc", nulls: "first" } }],
			select: {
				id: true,
				name: true,
				stage: true,
				stageChangedAt: true,
				lastActivityAt: true,
				company: { select: { id: true, name: true } },
				contacts: {
					select: {
						contact: { select: { id: true, firstName: true, lastName: true } },
					},
				},
			},
		}),
		db.followUpSuggestion.findMany({
			where: { userId, status: "PROPOSED" },
			select: { kind: true, contactId: true, companyId: true, dealId: true },
		}),
	]);

	const now = Date.now();

	return {
		rep,
		messages: messages.map((message) => ({
			id: message.id,
			threadId: message.threadId,
			direction: message.direction,
			fromEmail: message.fromEmail,
			fromName: message.fromName,
			subject: message.subject,
			sentAt: message.sentAt.toISOString(),
			body: message.body ?? message.snippet,
			contactId: message.thread.contactId,
			companyId: message.thread.companyId,
		})),
		openDeals: deals.map((deal) => ({
			id: deal.id,
			name: deal.name,
			companyId: deal.company.id,
			companyName: deal.company.name,
			stage: deal.stage,
			stageChangedAt: deal.stageChangedAt.toISOString(),
			lastActivityAt: deal.lastActivityAt?.toISOString() ?? null,
			daysSinceActivity: deal.lastActivityAt
				? Math.floor((now - deal.lastActivityAt.getTime()) / 86_400_000)
				: null,
			contacts: deal.contacts.map(({ contact }) => ({
				id: contact.id,
				name: [contact.firstName, contact.lastName].filter(Boolean).join(" "),
			})),
		})),
		alreadyProposed: proposed,
	};
}

export type ProposeFollowUpInput = {
	userId: string;
	kind: "commitment" | "reply-owed" | "deal-risk" | "next-step";
	summary: string;
	quote?: string;
	/** ISO-8601. */
	dueHint?: string;
	contactId?: string;
	companyId?: string;
	dealId?: string;
	evidence: { threadId: string; messageId: string; sentAt: string }[];
};

export type ProposeFollowUpResult =
	| { written: true; id: string }
	| { written: false; reason: string };

/**
 * The only way a `FollowUpSuggestion` reaches the table.
 *
 * Every cited message id is checked against the database before anything is
 * written — the same rule `facts.ts` enforces for a claim about a person:
 * nothing is recorded on say-so. An agent that names a message it never read
 * fails here rather than shipping a suggestion nobody can verify.
 */
export async function proposeFollowUp(
	input: ProposeFollowUpInput,
): Promise<ProposeFollowUpResult> {
	if (input.evidence.length === 0) {
		return {
			written: false,
			reason: "Every suggestion needs at least one cited message.",
		};
	}

	const messageIds = [...new Set(input.evidence.map((item) => item.messageId))];
	const found = await db.emailMessage.findMany({
		where: { id: { in: messageIds } },
		select: { id: true },
	});

	if (found.length !== messageIds.length) {
		return {
			written: false,
			reason:
				"One or more cited message ids do not exist. Only cite messages read from read_rep_followup_context.",
		};
	}

	// One outstanding suggestion per subject and kind — a deal that is still
	// stalled tomorrow does not need a second row saying so.
	const subject = input.dealId
		? { dealId: input.dealId }
		: input.contactId
			? { contactId: input.contactId }
			: input.companyId
				? { companyId: input.companyId }
				: {};

	const existing = await db.followUpSuggestion.findFirst({
		where: {
			userId: input.userId,
			kind: input.kind,
			status: "PROPOSED",
			...subject,
		},
		select: { id: true },
	});

	if (existing) {
		return {
			written: false,
			reason: "Already proposed and still outstanding.",
		};
	}

	const created = await db.followUpSuggestion.create({
		data: {
			userId: input.userId,
			contactId: input.contactId ?? null,
			companyId: input.companyId ?? null,
			dealId: input.dealId ?? null,
			kind: input.kind,
			summary: input.summary.trim(),
			quote: input.quote?.slice(0, 300) ?? null,
			dueHint: input.dueHint ? new Date(input.dueHint) : null,
			evidence: input.evidence,
			status: "PROPOSED",
		},
		select: { id: true },
	});

	return { written: true, id: created.id };
}
