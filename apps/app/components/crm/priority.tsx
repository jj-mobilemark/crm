"use client";

// `@crm/db/enums` and not `@crm/db`: the package root exports the Prisma client
// instance, so a value import of an enum drags `pg` into the browser bundle.
import { Priority } from "@crm/db/enums";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import {
	StatusIndicator,
	type StatusTone,
} from "@crm/ui/components/status-indicator";

/** Declaration order matches Postgres enum sort (LOW < … < HIGHEST). */
export const PRIORITIES = [
	Priority.LOW,
	Priority.MEDIUM,
	Priority.HIGH,
	Priority.HIGHEST,
] as const;

export type PriorityValue = (typeof PRIORITIES)[number];

/** Facet / select sentinel for "no priority set". */
export const PRIORITY_NONE = "none" as const;

const PRESENTATION: Record<PriorityValue, { label: string; tone: StatusTone }> =
	{
		LOW: { label: "Low", tone: "neutral" },
		MEDIUM: { label: "Medium", tone: "info" },
		HIGH: { label: "High", tone: "warning" },
		HIGHEST: { label: "Highest", tone: "error" },
	};

export function priorityLabel(value: PriorityValue | null | undefined): string {
	if (!value) return "No priority";
	return PRESENTATION[value].label;
}

export function priorityTone(
	value: PriorityValue | null | undefined,
): StatusTone {
	if (!value) return "neutral";
	return PRESENTATION[value].tone;
}

/** Options for a Select, including "No priority". */
export const PRIORITY_OPTIONS = [
	{ value: PRIORITY_NONE, label: "No priority" },
	...PRIORITIES.map((value) => ({
		value,
		label: PRESENTATION[value].label,
	})),
];

/** Facet options — counts gate visibility on list pages. */
export const PRIORITY_FACET_OPTIONS = [
	{ value: PRIORITY_NONE, label: "No priority" },
	...PRIORITIES.map((value) => ({
		value,
		label: PRESENTATION[value].label,
	})),
];

/**
 * Dot + label for a priority. Null renders an empty cell so tables stay quiet.
 */
export function PriorityBadge({
	priority,
}: {
	priority: PriorityValue | null | undefined;
}) {
	if (!priority) return <EmptyCellValue />;
	return (
		<StatusIndicator
			tone={PRESENTATION[priority].tone}
			label={PRESENTATION[priority].label}
		/>
	);
}
