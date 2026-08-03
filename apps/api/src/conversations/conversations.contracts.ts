import { z } from "zod";

const pipelineScope = z.enum(["me", "everyone"]);

/** Which record's conversations. Exactly one filing key, checked in the service. */
export const conversationListInput = z.object({
	contactId: z.string().optional(),
	companyId: z.string().optional(),
	dealId: z.string().optional(),
	pipelineScope: pipelineScope.optional(),
});

export type ConversationListInput = z.infer<typeof conversationListInput>;

/**
 * Where a conversation got to.
 *
 * The cursor is `useEveAgent`'s own `session` object, handed back so a reopened
 * panel resumes the thread instead of starting a new one.
 */
export const conversationSaveInput = z.object({
	contactId: z.string().optional(),
	companyId: z.string().optional(),
	dealId: z.string().optional(),
	pipelineScope: pipelineScope.optional(),
	sessionId: z.string(),
	continuationToken: z.string().nullish(),
	streamIndex: z.number().int().min(0).optional(),
	/** The opening question. Only used the first time. */
	title: z.string().optional(),
	messageCount: z.number().int().min(0).optional(),
});

export type ConversationSaveInput = z.infer<typeof conversationSaveInput>;

export const conversationIdInput = z.object({ id: z.string() });

/** The stored transcript of one conversation, for rehydrating the panel. */
export const conversationEventsInput = z.object({
	id: z.string(),
	/** An ordered *prefix*, so a very long thread stays a bounded payload. */
	limit: z.number().int().min(1).max(5000).default(2000),
});

export type ConversationEventsInput = z.infer<typeof conversationEventsInput>;
