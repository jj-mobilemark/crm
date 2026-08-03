import { ActivityType, Priority } from "@crm/db";
import { z } from "zod";

/** Types a human can log. `STAGE_CHANGE` and `ENRICHMENT` are written by the
 * system and the agent, and are not offered in the composer. */
const COMPOSABLE_TYPES = [
	ActivityType.NOTE,
	ActivityType.CALL,
	ActivityType.EMAIL,
	ActivityType.MEETING,
	ActivityType.TASK,
] as const;

const composableEnum = z.enum(COMPOSABLE_TYPES);

const priorityEnum = z.enum(
	Object.values(Priority) as [Priority, ...Priority[]],
);

/**
 * Which slice of a timeline to show.
 *
 * `history` is `all` minus the tasks that are still outstanding: the timeline
 * pins those at the top, and an entry that appears both pinned and in the
 * history below it reads as two different things having happened.
 */
const TIMELINE_FILTERS = [
	"all",
	"history",
	"notes",
	"upcoming",
	"done",
	/** Synced Gmail threads and logged emails. */
	"email",
	/** Synced calendar events and logged meetings. */
	"meetings",
] as const;

export type TimelineFilter = (typeof TIMELINE_FILTERS)[number];

/**
 * Exactly one anchor. A timeline is always "everything about this thing", and
 * a company's timeline picks up its deals' and contacts' entries for free
 * because `companyId` is stamped on write.
 */
export const timelineInput = z.object({
	companyId: z.string().optional(),
	contactId: z.string().optional(),
	dealId: z.string().optional(),
	filter: z.enum(TIMELINE_FILTERS).default("all"),
	/** Activity id to continue after — timelines page by cursor, not by offset,
	 * because new entries arrive at the top while you are reading. */
	cursor: z.string().optional(),
	limit: z.number().int().min(1).max(100).default(30),
});

export type TimelineInput = z.infer<typeof timelineInput>;

/** The same anchor, without the paging — for the filter tab counts. */
export const timelineCountsInput = z.object({
	companyId: z.string().optional(),
	contactId: z.string().optional(),
	dealId: z.string().optional(),
});

export const activityCreateInput = z
	.object({
		type: composableEnum,
		subject: z.string().trim().optional(),
		body: z.string().trim().optional(),
		/** ISO-8601. When it happened, for something being logged after the fact. */
		occurredAt: z.string().optional(),
		/** ISO-8601. When it is due, for a task. */
		dueAt: z.string().nullable().optional(),
		/** Null / omitted = no priority. Only meaningful for TASK. */
		priority: priorityEnum.nullable().optional(),
		companyId: z.string().optional(),
		contactId: z.string().optional(),
		dealId: z.string().optional(),
	})
	.refine((input) => input.companyId || input.contactId || input.dealId, {
		message: "An activity has to be about a company, a contact or a deal.",
	})
	.refine(
		(input) => input.type !== ActivityType.TASK || Boolean(input.subject),
		{
			message: "A task needs a subject — it is the thing to do.",
			path: ["subject"],
		},
	);

export type ActivityCreateInput = z.infer<typeof activityCreateInput>;

export const completeInput = z.object({
	id: z.string(),
	/** `false` reopens a task that was ticked off by mistake. */
	completed: z.boolean().default(true),
});

export const setPriorityInput = z.object({
	id: z.string(),
	/** Null clears priority. */
	priority: priorityEnum.nullable(),
});

export const myTasksInput = z.object({
	/** `"overdue"`, `"upcoming"`, or `"all"` by due date. */
	window: z.enum(["overdue", "upcoming", "all"]).default("all"),
	/** Open, done, or everything. Defaults to open — that is the working list. */
	status: z.enum(["open", "done", "all"]).default("open"),
	/** A `Priority`, `"none"` (null), or `"all"`. */
	priority: z.string().default("all"),
	limit: z.number().int().min(1).max(100).default(25),
});

export type MyTasksInput = z.infer<typeof myTasksInput>;
