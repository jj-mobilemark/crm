import { z } from "zod";
import { SYNC_SOURCES } from "./microsoft.constants";

/**
 * Exported under `ms*` names so nestjs-trpc's generated `server.ts` does not
 * collapse them with the identically-named Google contracts into one import.
 */
export const msSyncSourceInput = z.object({
	source: z.enum(SYNC_SOURCES),
});

export const msSetAutoCreateInput = z.object({
	source: z.enum(SYNC_SOURCES),
	enabled: z.boolean(),
});

export const msSetDailyTaskPushInput = z.object({
	enabled: z.boolean(),
});

export const msSuppressDomainInput = z.object({
	domain: z.string().trim().min(1),
	reason: z.string().trim().max(200).optional(),
	/** Also remove the threads and events this domain already produced. */
	purge: z.boolean().default(true),
});

export const msThreadInput = z.object({
	threadId: z.string(),
});

export const msCalendarEventInput = z.object({
	eventId: z.string(),
});

export type MsSetAutoCreateInput = z.infer<typeof msSetAutoCreateInput>;
export type MsSetDailyTaskPushInput = z.infer<typeof msSetDailyTaskPushInput>;
export type MsSuppressDomainInput = z.infer<typeof msSuppressDomainInput>;
