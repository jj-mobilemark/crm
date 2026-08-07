import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import {
	claimDue,
	completeTask,
	MANUAL_COMPANY_PRIORITY,
	MAX_ATTEMPTS,
	retireAutoEnrichmentTasks,
	retireExhausted,
	scheduleTask,
} from "../agent/lib/tasks";

/**
 * The work queue against a real database.
 *
 * The lease is raw SQL — `FOR UPDATE SKIP LOCKED` has no Prisma equivalent —
 * which is exactly the kind of code that typechecks and then does the wrong
 * thing at runtime. It is also the thing standing between one dispatcher and
 * two dispatchers doing every job twice.
 */

const kind = "test-lease";

async function clear() {
	// Tasks first: they reference the contacts below.
	await db.agentTask.deleteMany({ where: { kind } });
	await db.contact.deleteMany({ where: { email: { startsWith: "lease-" } } });
}

beforeEach(() => {
	process.env.AGENT_AUTO_ENRICH = "true";
	return clear();
});
afterEach(clear);

async function queue(
	overrides: { priority?: number; dueAt?: Date; contactId?: string } = {},
) {
	return db.agentTask.create({
		data: {
			kind,
			reason: "test",
			dueAt: overrides.dueAt ?? new Date(Date.now() - 1000),
			priority: overrides.priority ?? 0,
			budget: 4,
			contactId: overrides.contactId ?? null,
		},
		select: { id: true },
	});
}

/** Frees a leased row the way a dispatcher dying mid-run would. */
async function expire(taskId: string) {
	await db.agentTask.update({
		where: { id: taskId },
		data: { leasedUntil: new Date(Date.now() - 1000) },
	});
}

/** A contact to hang a task off, so the subject can be asserted on. */
async function someone() {
	return db.contact.create({
		data: {
			firstName: "Lease",
			email: `lease-${crypto.randomUUID()}@example.test`,
		},
		select: { id: true },
	});
}

describe("claimDue", () => {
	it("claims due work and leases it", async () => {
		const task = await queue();

		const claimed = await claimDue(10);
		expect(claimed.map((t) => t.id)).toContain(task.id);

		const row = await db.agentTask.findUnique({ where: { id: task.id } });
		expect(row?.leasedUntil).not.toBeNull();
		expect(row?.startedAt).not.toBeNull();
	});

	it("does not hand the same row to two dispatchers", async () => {
		await Promise.all([queue(), queue(), queue()]);

		// The case the raw SQL exists for: two ticks landing together must take
		// disjoint sets, not race for the same rows.
		const [first, second] = await Promise.all([claimDue(3), claimDue(3)]);
		const ids = [...first, ...second].map((t) => t.id);

		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toHaveLength(3);
	});

	it("leaves work that is not due yet", async () => {
		await queue({ dueAt: new Date(Date.now() + 60_000) });
		const claimed = await claimDue(10);
		expect(claimed).toHaveLength(0);
	});

	it("takes the most urgent first", async () => {
		const low = await queue({ priority: 0 });
		const high = await queue({ priority: 100 });

		const claimed = await claimDue(1);
		expect(claimed[0]?.id).toBe(high.id);
		expect(claimed[0]?.id).not.toBe(low.id);
	});

	it("does not re-claim a leased row, and does re-claim an expired one", async () => {
		const task = await queue();
		await claimDue(10);

		expect(await claimDue(10)).toHaveLength(0);

		// A run that died mid-task must not strand its row forever.
		await db.agentTask.update({
			where: { id: task.id },
			data: { leasedUntil: new Date(Date.now() - 1000) },
		});

		expect((await claimDue(10)).map((t) => t.id)).toContain(task.id);
	});

	/**
	 * The money bug. Two rows were re-leased every ten minutes for an hour and a
	 * half, resuming the same durable session and paying for a model turn each
	 * time, because nothing counted how often that had already happened.
	 */
	it("stops handing out a row that has spent its attempts", async () => {
		const task = await queue();

		for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
			expect((await claimDue(10)).map((t) => t.id)).toContain(task.id);
			await expire(task.id);
		}

		expect(await claimDue(10)).toHaveLength(0);
	});

	it("counts the attempts it has handed out", async () => {
		const task = await queue();

		expect((await claimDue(10))[0]?.attempts).toBe(1);
		await expire(task.id);
		expect((await claimDue(10))[0]?.attempts).toBe(2);
	});

	it("stops claiming once the work is finished", async () => {
		const task = await queue();
		await claimDue(10);
		await completeTask(task.id, "ran");

		await db.agentTask.update({
			where: { id: task.id },
			data: { leasedUntil: null },
		});

		expect(await claimDue(10)).toHaveLength(0);
	});
});

describe("retireExhausted", () => {
	it("gives up on a row that never reported back, and says who it was about", async () => {
		const contact = await someone();
		const task = await queue({ contactId: contact.id });

		for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
			await claimDue(10);
			await expire(task.id);
		}

		const retired = await retireExhausted();
		expect(retired.map((t) => t.id)).toContain(task.id);
		// The subject comes back so the caller can tell the record, rather than
		// leaving it saying somebody is still working on it.
		expect(retired.find((t) => t.id === task.id)?.contactId).toBe(contact.id);

		const row = await db.agentTask.findUnique({ where: { id: task.id } });
		expect(row?.finishedAt).not.toBeNull();
		expect(row?.outcome).toContain("Gave up");
	});

	it("leaves a row that is still leased on its last attempt alone", async () => {
		const task = await queue();

		for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
			await claimDue(10);
			if (attempt < MAX_ATTEMPTS - 1) await expire(task.id);
		}

		// Still holding a live lease: the run may yet park and close it itself.
		expect(await retireExhausted()).toHaveLength(0);
	});

	it("leaves work that still has attempts left", async () => {
		await queue();
		await claimDue(10);

		expect(await retireExhausted()).toHaveLength(0);
	});
});

describe("completeTask", () => {
	it("retires a row once, and reports who it was about", async () => {
		const contact = await someone();
		const task = await queue({ contactId: contact.id });
		await claimDue(10);

		const subject = await completeTask(task.id, "ran");
		expect(subject?.contactId).toBe(contact.id);

		// A session parks at the end of every turn. Only the turn that belongs to
		// this dispatch may close the row — a later one must not re-stamp it.
		expect(await completeTask(task.id, "ran again")).toBeNull();
		const row = await db.agentTask.findUnique({ where: { id: task.id } });
		expect(row?.outcome).toBe("ran");
	});
});

describe("scheduleTask", () => {
	it("books work with the agent's own reason", async () => {
		const dueAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
		const { id } = await scheduleTask({
			kind,
			reason: "a job change here would move the Acme deal",
			dueAt,
		});

		const row = await db.agentTask.findUnique({ where: { id } });
		expect(row?.reason).toContain("Acme");
	});

	it("moves the existing booking rather than queueing a second one", async () => {
		const soon = new Date(Date.now() + 1000);
		const later = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

		const first = await scheduleTask({ kind, reason: "first", dueAt: soon });
		const second = await scheduleTask({ kind, reason: "second", dueAt: later });

		expect(second.id).toBe(first.id);
		expect(await db.agentTask.count({ where: { kind } })).toBe(1);
	});
});

describe("AGENT_AUTO_ENRICH off", () => {
	it("claims only manual company-profile and retires auto backlog", async () => {
		delete process.env.AGENT_AUTO_ENRICH;

		const autoId = (
			await db.agentTask.create({
				data: {
					kind: "identify",
					reason: "sync",
					dueAt: new Date(Date.now() - 1000),
					priority: 20,
					budget: 4,
				},
				select: { id: true },
			})
		).id;

		const manualId = (
			await db.agentTask.create({
				data: {
					kind: "company-profile",
					reason: "A rep asked for a fresh look",
					dueAt: new Date(Date.now() - 1000),
					priority: MANUAL_COMPANY_PRIORITY,
					budget: 8,
				},
				select: { id: true },
			})
		).id;

		const lowCompany = (
			await db.agentTask.create({
				data: {
					kind: "company-profile",
					reason: "New company",
					dueAt: new Date(Date.now() - 1000),
					priority: 10,
					budget: 4,
				},
				select: { id: true },
			})
		).id;

		const retired = await retireAutoEnrichmentTasks();
		expect(retired).toBeGreaterThanOrEqual(2);

		const claimed = await claimDue(10);
		expect(claimed.map((t) => t.id)).toContain(manualId);
		expect(claimed.every((t) => t.id !== autoId && t.id !== lowCompany)).toBe(
			true,
		);

		expect(
			(await db.agentTask.findUnique({ where: { id: autoId } }))?.finishedAt,
		).not.toBeNull();
		expect(
			(await db.agentTask.findUnique({ where: { id: lowCompany } }))
				?.finishedAt,
		).not.toBeNull();

		await db.agentTask.deleteMany({
			where: { id: { in: [autoId, manualId, lowCompany] } },
		});
	});
});
