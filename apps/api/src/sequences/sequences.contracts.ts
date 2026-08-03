import {
	EmailSequenceStatus,
	SequenceEnrollmentStatus,
} from "@crm/db";
import { z } from "zod";

const sequenceStatusEnum = z.enum(
	Object.values(EmailSequenceStatus) as [
		EmailSequenceStatus,
		...EmailSequenceStatus[],
	],
);

const enrollmentStatusEnum = z.enum(
	Object.values(SequenceEnrollmentStatus) as [
		SequenceEnrollmentStatus,
		...SequenceEnrollmentStatus[],
	],
);

export const sequenceIdInput = z.object({ id: z.string().min(1) });

export const sequenceStepInput = z.object({
	order: z.number().int().min(0),
	delayMinutes: z.number().int().min(0).default(0),
	subject: z.string().trim().min(1, "Each step needs a subject."),
	bodyTemplate: z.string().min(1, "Each step needs a body."),
});

export const sequenceCreateInput = z.object({
	name: z.string().trim().min(1, "A sequence needs a name."),
	description: z.string().trim().nullable().optional(),
	timezone: z.string().trim().min(1).optional(),
	sendWindowStartMinute: z.number().int().min(0).max(1439).optional(),
	sendWindowEndMinute: z.number().int().min(1).max(1440).optional(),
	/** Weekday ints 0=Sunday … 6=Saturday. */
	sendDays: z.array(z.number().int().min(0).max(6)).min(1).optional(),
	stopOnReply: z.boolean().optional(),
	trackingEnabled: z.boolean().optional(),
	steps: z.array(sequenceStepInput).min(1, "Add at least one step."),
});

export type SequenceCreateInput = z.infer<typeof sequenceCreateInput>;

export const sequenceUpdateInput = z.object({
	id: z.string().min(1),
	data: z.object({
		name: z.string().trim().min(1).optional(),
		description: z.string().trim().nullable().optional(),
		status: sequenceStatusEnum.optional(),
		timezone: z.string().trim().min(1).optional(),
		sendWindowStartMinute: z.number().int().min(0).max(1439).optional(),
		sendWindowEndMinute: z.number().int().min(1).max(1440).optional(),
		sendDays: z.array(z.number().int().min(0).max(6)).min(1).optional(),
		stopOnReply: z.boolean().optional(),
		trackingEnabled: z.boolean().optional(),
	}),
});

export type SequenceUpdateInput = z.infer<typeof sequenceUpdateInput>;

export const sequenceReplaceStepsInput = z.object({
	sequenceId: z.string().min(1),
	steps: z.array(sequenceStepInput).min(1),
});

export type SequenceReplaceStepsInput = z.infer<
	typeof sequenceReplaceStepsInput
>;

export const sequenceEnrollInput = z.object({
	sequenceId: z.string().min(1),
	contactIds: z.array(z.string().min(1)).min(1),
});

export type SequenceEnrollInput = z.infer<typeof sequenceEnrollInput>;

export const enrollmentIdInput = z.object({ id: z.string().min(1) });

export const enrollmentListInput = z.object({
	sequenceId: z.string().min(1),
	status: enrollmentStatusEnum.optional(),
});

export type EnrollmentListInput = z.infer<typeof enrollmentListInput>;
