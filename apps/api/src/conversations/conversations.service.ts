import type { Db } from "@crm/db";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import {
	BadRequestException,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import type { Cache } from "cache-manager";
import { InjectDatabase } from "../database/database.constants";
import type {
	ConversationEventsInput,
	ConversationListInput,
	ConversationSaveInput,
} from "./conversations.contracts";

/**
 * A record's conversations with the agent.
 *
 * The transcript itself lives in `AgentEvent`, written by the agent's audit
 * hook. This is the handle: which durable eve session belongs to which record,
 * and enough to list them without touching an event.
 *
 * **This is not the API doing intelligence** (`api.md`). Nothing here
 * researches, scores or decides anything — it is a list of a record's history,
 * which is exactly the sort of thing the data surface is for. The agent still
 * owns every judgement; this owns the filing.
 *
 * Cached deliberately, per value, the way `AuthService.getProfile` is: read
 * through, write on miss, explicit invalidation when something changes. The
 * list is read on every open of a contact sheet and changes only when somebody
 * sends a message, which is the shape a cache is actually for.
 */

export interface ConversationSummary {
	id: string;
	sessionId: string;
	continuationToken: string | null;
	streamIndex: number;
	title: string | null;
	messageCount: number;
	/** ISO-8601: a `Date` comes back from Redis as a string anyway. */
	lastMessageAt: string;
}

/**
 * Long, because every write invalidates.
 *
 * A TTL is the backstop for a missed invalidation, not the freshness
 * mechanism — five minutes of staleness on a list nobody changed is not worth
 * the round trips.
 */
const LIST_TTL_MS = 10 * 60_000;

const listKey = (userId: string, recordId: string) =>
	`agent:conversations:${userId}:${recordId}`;

@Injectable()
export class ConversationsService {
	private readonly logger = new Logger(ConversationsService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		@Inject(CACHE_MANAGER) private readonly cache: Cache,
	) {}

	/**
	 * Every conversation this rep has had about this record, newest first.
	 *
	 * Scoped to the caller. Two reps asking about the same contact are having
	 * two different conversations, and half of one appearing in the other's
	 * panel would be both confusing and a small privacy surprise.
	 */
	async list(
		input: ConversationListInput,
		userId: string,
	): Promise<ConversationSummary[]> {
		const recordId = this.recordId(input);
		const key = listKey(userId, recordId);

		const cached = await this.cache.get<ConversationSummary[]>(key);
		if (cached) return cached;

		this.logger.debug({ message: "Conversation list cache miss", recordId });

		const rows = await this.db.agentConversation.findMany({
			where: {
				userId,
				...(input.contactId ? { contactId: input.contactId } : {}),
				...(input.companyId ? { companyId: input.companyId } : {}),
				...(input.dealId ? { dealId: input.dealId } : {}),
				...(input.pipelineScope
					? { pipelineScope: input.pipelineScope }
					: {}),
			},
			orderBy: { lastMessageAt: "desc" },
			take: 20,
			select: {
				id: true,
				sessionId: true,
				continuationToken: true,
				streamIndex: true,
				title: true,
				messageCount: true,
				lastMessageAt: true,
			},
		});

		const summaries = rows.map((row) => ({
			...row,
			lastMessageAt: row.lastMessageAt.toISOString(),
		}));

		await this.cache.set(key, summaries, LIST_TTL_MS);

		return summaries;
	}

	/**
	 * Records where a conversation got to.
	 *
	 * Upserted on the session id, because the client calls this every time the
	 * cursor moves and the first call is the one that creates the row. `title`
	 * is written once — it is the opening question, and a thread renaming itself
	 * as it goes is a thread nobody can find again.
	 */
	async save(
		input: ConversationSaveInput,
		userId: string,
	): Promise<{ id: string }> {
		const recordId = this.recordId(input);

		const conversation = await this.db.agentConversation.upsert({
			where: { sessionId: input.sessionId },
			create: {
				sessionId: input.sessionId,
				continuationToken: input.continuationToken ?? null,
				streamIndex: input.streamIndex ?? 0,
				title: input.title?.slice(0, 120) ?? null,
				messageCount: input.messageCount ?? 0,
				userId,
				contactId: input.contactId ?? null,
				companyId: input.companyId ?? null,
				dealId: input.dealId ?? null,
				pipelineScope: input.pipelineScope ?? null,
			},
			update: {
				continuationToken: input.continuationToken ?? null,
				streamIndex: input.streamIndex ?? 0,
				messageCount: input.messageCount ?? 0,
				lastMessageAt: new Date(),
			},
			select: { id: true, userId: true },
		});

		// A session belongs to whoever started it. Nothing in the UI can produce
		// this, but a session id is guessable-ish and the check is one comparison.
		if (conversation.userId !== userId) {
			throw new BadRequestException(
				"That conversation belongs to someone else.",
			);
		}

		await this.cache.del(listKey(userId, recordId));

		return { id: conversation.id };
	}

	/**
	 * The transcript of one conversation, in the shape the panel's reducer eats.
	 *
	 * Why this exists rather than replaying eve's own stream: these events are
	 * already ours. The audit hook wrote them as they happened, they outlive
	 * eve's 30-day session retention, and reading them costs the agent nothing —
	 * a rep scrolling last month's thread should not wake the research runtime.
	 *
	 * An ordered prefix, oldest first, because that is what rehydrating a
	 * projection means: the reducer replays it in order to rebuild the messages.
	 */
	async events(input: ConversationEventsInput, userId: string) {
		const conversation = await this.db.agentConversation.findUnique({
			where: { id: input.id },
			select: { sessionId: true, userId: true },
		});

		if (!conversation || conversation.userId !== userId) {
			throw new NotFoundException(`No conversation with id ${input.id}.`);
		}

		const events = await this.db.agentEvent.findMany({
			where: { sessionId: conversation.sessionId },
			orderBy: { emittedAt: "asc" },
			take: input.limit,
			select: { id: true, type: true, data: true, emittedAt: true },
		});

		return events.map((event) => ({
			type: event.type,
			data: event.data,
			// The envelope the client dedupes and orders on.
			meta: { id: event.id, at: event.emittedAt.toISOString() },
		}));
	}

	/** Forgets a conversation, and the events behind it. */
	async remove(id: string, userId: string): Promise<{ id: string }> {
		const conversation = await this.db.agentConversation.findUnique({
			where: { id },
			select: {
				id: true,
				userId: true,
				contactId: true,
				companyId: true,
				dealId: true,
				pipelineScope: true,
				sessionId: true,
			},
		});

		if (!conversation || conversation.userId !== userId) {
			throw new NotFoundException(`No conversation with id ${id}.`);
		}

		await this.db.$transaction([
			this.db.agentEvent.deleteMany({
				where: { sessionId: conversation.sessionId },
			}),
			this.db.agentConversation.delete({ where: { id } }),
		]);

		await this.cache.del(
			listKey(
				userId,
				conversation.contactId ??
					conversation.companyId ??
					conversation.dealId ??
					(conversation.pipelineScope
						? `pipeline:${conversation.pipelineScope}`
						: ""),
			),
		);

		this.logger.log({ message: "Conversation removed", conversationId: id });

		return { id };
	}

	/** One filing key per conversation, and it has to be said which. */
	private recordId(input: {
		contactId?: string;
		companyId?: string;
		dealId?: string;
		pipelineScope?: string;
	}): string {
		const keys = [
			input.contactId,
			input.companyId,
			input.dealId,
			input.pipelineScope ? `pipeline:${input.pipelineScope}` : undefined,
		].filter(Boolean);

		if (keys.length !== 1) {
			throw new BadRequestException(
				"A conversation belongs to a contact, a company, a deal, or the pipeline.",
			);
		}

		return keys[0] as string;
	}
}
