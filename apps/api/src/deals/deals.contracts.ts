import { DealStage, Priority } from "@crm/db";
import { z } from "zod";
import { listInput } from "../trpc/list-input";

/** Buckets for the "closing" facet. */
export const CLOSING_WINDOWS = [
	"overdue",
	"this-month",
	"next-month",
	"later",
	"none",
] as const;

export type ClosingWindow = (typeof CLOSING_WINDOWS)[number];

const priorityEnum = z.enum(
	Object.values(Priority) as [Priority, ...Priority[]],
);

export const dealListInput = listInput.extend({
	/**
	 * The tab: `"open"`, `"closed"` or `"all"`.
	 *
	 * Open and closed rather than one tab per stage — a rep wants "what am I
	 * working" and "what happened", and the stage facet covers the rest.
	 */
	status: z.string().default("all"),
	/**
	 * A user id, or `"all"`. `"unassigned"` is accepted so every list speaks the
	 * same facet language, but a deal always has an owner, so it matches nothing.
	 */
	owner: z.string().default("all"),
	/** A `DealStage`, or `"all"`. */
	stage: z.string().default("all"),
	/** A `ClosingWindow`, or `"all"`. */
	closing: z.string().default("all"),
	/** A company id, or `"all"`. Deals always have a company — no `"none"`. */
	company: z.string().default("all"),
	/** A `Priority`, `"none"` (null), or `"all"`. */
	priority: z.string().default("all"),
});

export type DealListInput = z.infer<typeof dealListInput>;

const stageEnum = z.enum(
	Object.values(DealStage) as [DealStage, ...DealStage[]],
);

export const dealCreateInput = z.object({
	name: z.string().trim().min(1, "A deal needs a name."),
	companyId: z.string().min(1, "A deal belongs to a company."),
	/** Required — every deal has a name against it. */
	ownerId: z.string().min(1, "A deal needs an owner."),
	stage: stageEnum.optional(),
	/** Integer cents, so summing a pipeline is exact. */
	amountCents: z.number().int().min(0).nullable().optional(),
	currency: z.string().length(3).optional(),
	/** ISO-8601 date. */
	expectedCloseDate: z.string().nullable().optional(),
	/** Null / omitted = no priority. */
	priority: priorityEnum.nullable().optional(),
});

export type DealCreateInput = z.infer<typeof dealCreateInput>;

/** `undefined` leaves a field alone. Stage is not here — it goes through
 * `setStage`, which also writes the timeline entry. */
const dealUpdateInput = z.object({
	name: z.string().trim().min(1).optional(),
	companyId: z.string().optional(),
	ownerId: z.string().optional(),
	amountCents: z.number().int().min(0).nullable().optional(),
	currency: z.string().length(3).optional(),
	expectedCloseDate: z.string().nullable().optional(),
	/** Null clears priority. */
	priority: priorityEnum.nullable().optional(),
});

export type DealUpdateInput = z.infer<typeof dealUpdateInput>;

export const dealUpdateArgs = z.object({
	id: z.string(),
	data: dealUpdateInput,
});

export const dealIdInput = z.object({ id: z.string() });

export const setStageInput = z.object({
	id: z.string(),
	stage: stageEnum,
	/** Why it was lost or disqualified. Required for the losing stages. */
	closedReason: z.string().trim().optional(),
});

export type SetStageInput = z.infer<typeof setStageInput>;
