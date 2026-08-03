import { Priority } from "@crm/db/enums";
import {
	createLoader,
	parseAsStringLiteral,
	type SearchParams,
} from "nuqs/server";

/**
 * Priority filter values live here (not in `components/crm/priority`) so this
 * server module never imports a client boundary — `priority.tsx` is `"use
 * client"` because it renders UI.
 */
const PRIORITIES = [
	Priority.LOW,
	Priority.MEDIUM,
	Priority.HIGH,
	Priority.HIGHEST,
] as const;
const PRIORITY_NONE = "none" as const;

const STATUSES = ["open", "done", "all"] as const;
const WINDOWS = ["all", "overdue", "upcoming"] as const;
const PRIORITY_FILTERS = ["all", PRIORITY_NONE, ...PRIORITIES] as const;

export const tasksParsers = {
	status: parseAsStringLiteral(STATUSES).withDefault("open"),
	window: parseAsStringLiteral(WINDOWS).withDefault("all"),
	priority: parseAsStringLiteral(PRIORITY_FILTERS).withDefault("all"),
};

export const loadTasksSearchParams = createLoader(tasksParsers);

export type TasksSearchValues = Awaited<
	ReturnType<typeof loadTasksSearchParams>
>;

export function tasksQueryInput(values: TasksSearchValues) {
	return {
		status: values.status,
		window: values.window,
		priority: values.priority,
		limit: 100,
	};
}

export async function parseTasksSearchParams(
	searchParams: Promise<SearchParams>,
) {
	return loadTasksSearchParams(searchParams);
}
