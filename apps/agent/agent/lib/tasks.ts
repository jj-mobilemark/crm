import { db, type Prisma } from "@crm/db";

/**
 * The work queue the agent both reads and writes.
 *
 * The point of a table rather than a cron expression per kind of work: a cron
 * can only say "every hour, for everybody". A row can say *this person, in
 * fourteen days, because a job change here would move a live deal* — and the
 * reason is the agent's own words, shown to the rep on the record.
 */

export type LeasedTask = {
	id: string;
	contactId: string | null;
	companyId: string | null;
	userId: string | null;
	kind: string;
	reason: string;
	budget: number;
	attempts: number;
};

/** The subject of a row, which is what an enrichment status hangs off. */
export type TaskSubject = {
	id: string;
	contactId: string | null;
	companyId: string | null;
	userId: string | null;
	kind: string;
};

/** How long a dispatcher tick holds a row before another one may retry it. */
const LEASE_MS = 10 * 60_000;

/**
 * How many hand-offs a row gets before it is given up on.
 *
 * The lease makes a crashed run recoverable; this makes an unrecoverable one
 * stop. Three is enough to ride out a redeploy and a transient vendor outage,
 * and small enough that a task which can never park costs three model turns
 * rather than one every ten minutes until somebody notices.
 */
export const MAX_ATTEMPTS = 3;

/**
 * Claims due work atomically.
 *
 * `FOR UPDATE SKIP LOCKED` inside the subquery is what makes this safe to run
 * from more than one process at a time — two dispatchers ticking together take
 * disjoint sets rather than racing for the same row. That matters more than it
 * looks: it is what lets the agent be deployed twice (its own service, and
 * embedded in the app) without doing every job twice.
 *
 * The lease is a deadline rather than a flag, so a run that crashes mid-task
 * frees itself. A `finishedAt` is what actually retires a row.
 *
 * Each claim charges an attempt. Rows that have spent their allowance are
 * skipped here and retired by `retireExhausted`.
 */
export async function claimDue(limit: number): Promise<LeasedTask[]> {
	const now = new Date();
	const until = new Date(now.getTime() + LEASE_MS);

	return db.$queryRaw<LeasedTask[]>`
		UPDATE "agentTask" AS t
		SET "leasedUntil" = ${until},
			"startedAt" = COALESCE(t."startedAt", ${now}),
			"attempts" = t."attempts" + 1
		FROM (
			SELECT id FROM "agentTask"
			WHERE "finishedAt" IS NULL
				AND "dueAt" <= ${now}
				AND ("leasedUntil" IS NULL OR "leasedUntil" < ${now})
				AND "attempts" < ${MAX_ATTEMPTS}
			ORDER BY "priority" DESC, "dueAt" ASC
			LIMIT ${limit}
			FOR UPDATE SKIP LOCKED
		) AS due
		WHERE t.id = due.id
		RETURNING t.id, t."contactId", t."companyId", t."userId", t.kind, t.reason, t.budget, t.attempts;
	`;
}

/**
 * Gives up on rows that have been dispatched their allowance without ever
 * reporting back, and hands them to the caller so the record can say so.
 *
 * Only unleased rows, so a run still legitimately in flight on its last
 * attempt is left alone.
 */
export async function retireExhausted(): Promise<TaskSubject[]> {
	const now = new Date();

	return db.$queryRaw<TaskSubject[]>`
		UPDATE "agentTask" AS t
		SET "finishedAt" = ${now},
			"outcome" = ${`Gave up after ${MAX_ATTEMPTS} attempts: the session never reported back.`}
		WHERE t."finishedAt" IS NULL
			AND t."attempts" >= ${MAX_ATTEMPTS}
			AND (t."leasedUntil" IS NULL OR t."leasedUntil" < ${now})
		RETURNING t.id, t."contactId", t."companyId", t."userId", t.kind;
	`;
}

/**
 * Retires a row, once.
 *
 * The `finishedAt IS NULL` guard is what makes this idempotent: a session parks
 * at the end of every turn, and only the turn that belongs to this dispatch
 * should close the row. A second park — a rep carrying on the same thread from
 * the sheet, say — finds it already closed and returns null rather than
 * re-stamping an outcome over the real one.
 */
export async function completeTask(
	taskId: string,
	outcome: string,
	sessionId?: string,
): Promise<TaskSubject | null> {
	const { count } = await db.agentTask.updateMany({
		where: { id: taskId, finishedAt: null },
		data: {
			finishedAt: new Date(),
			outcome: outcome.slice(0, 500),
			...(sessionId ? { sessionId } : {}),
		},
	});

	if (count === 0) return null;

	return db.agentTask.findUnique({
		where: { id: taskId },
		select: {
			id: true,
			contactId: true,
			companyId: true,
			userId: true,
			kind: true,
		},
	});
}

/** Who a row is about, without disturbing it. */
export async function taskSubject(taskId: string): Promise<TaskSubject | null> {
	return db.agentTask.findUnique({
		where: { id: taskId },
		select: {
			id: true,
			contactId: true,
			companyId: true,
			userId: true,
			kind: true,
		},
	});
}

/**
 * Records which durable session took the work.
 *
 * Written at hand-off rather than at completion, because `receive` resolves as
 * soon as the session accepts the message — the run itself outlives the
 * dispatcher tick that started it, and this is the only thread back to it.
 */
export async function noteSession(
	taskId: string,
	sessionId: string,
): Promise<void> {
	await db.agentTask.updateMany({
		where: { id: taskId, finishedAt: null },
		data: { sessionId },
	});
}

/**
 * Books the next look at somebody.
 *
 * The reason is not decoration — it is shown on the record, and it is the
 * difference between an agent that runs on a schedule and one that has a view
 * about who is worth revisiting.
 */
export async function scheduleTask(input: {
	contactId?: string | null;
	companyId?: string | null;
	kind: string;
	reason: string;
	dueAt: Date;
	priority?: number;
	budget?: number;
}): Promise<{ id: string }> {
	// One outstanding task per subject and kind. An agent that queues itself
	// twice for the same person is an agent that spends twice as much to learn
	// the same thing.
	const existing = await db.agentTask.findFirst({
		where: {
			kind: input.kind,
			finishedAt: null,
			contactId: input.contactId ?? undefined,
			companyId: input.companyId ?? undefined,
		},
		select: { id: true },
	});

	if (existing) {
		await db.agentTask.update({
			where: { id: existing.id },
			data: { dueAt: input.dueAt, reason: input.reason },
		});
		return existing;
	}

	return db.agentTask.create({
		data: {
			contactId: input.contactId ?? null,
			companyId: input.companyId ?? null,
			kind: input.kind,
			reason: input.reason,
			dueAt: input.dueAt,
			priority: input.priority ?? 0,
			budget: input.budget ?? 4,
		},
		select: { id: true },
	});
}

/** What the agent last decided about a contact, for the sheet to show. */
export async function lastDecision(contactId: string) {
	return db.agentTask.findFirst({
		where: { contactId },
		orderBy: { createdAt: "desc" },
		select: {
			kind: true,
			reason: true,
			dueAt: true,
			finishedAt: true,
			outcome: true,
		},
	});
}

/** Kept for the raw query above to stay type-checked against the schema. */
export type { Prisma };
