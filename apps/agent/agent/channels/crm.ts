import { EnrichmentStatus } from "@crm/db";
import { defineChannel, POST } from "eve/channels";
import { settle } from "../lib/enrichment";
import { completeTask, taskSubject } from "../lib/tasks";

/**
 * The CRM itself, as a place work arrives from.
 *
 * The dispatcher needs a channel to hand a task to, and the built-in HTTP
 * channel is not one: it answers requests, it has no `receive` hook, and there
 * is nothing to deliver a reply *to*. This is the other shape — a channel whose
 * whole job is to start a durable session and let the tools do the writing.
 *
 * There is deliberately no delivery. A run that identifies somebody has already
 * succeeded by the time it would have something to say, because success is a
 * fact on a record rather than a message to a person. If this ever needs to
 * tell somebody something, the timeline is where it goes.
 */

/** The token format this channel owns. eve namespaces it by file stem. */
function taskToken(taskId: string): string {
	return `crm:task:${taskId}`;
}

/** The task a session is working for, or null if it is not working for one. */
function taskFromToken(token: string | undefined): string | null {
	if (!token) return null;
	const prefix = "crm:task:";
	return token.startsWith(prefix) ? token.slice(prefix.length) : null;
}

export default defineChannel({
	/**
	 * Work reaches this channel by hand-off from the dispatcher, not by request
	 * — the API queues a row, it does not call us. So this route is not an entry
	 * point and refuses everything.
	 *
	 * It exists because eve builds its channel registry *from routes*: one
	 * manifest entry per method/path pair. With `routes: []` the channel
	 * compiles to nothing, never registers, and `receive(crm, …)` fails with
	 * "the channel passed as the first argument is not registered in this
	 * agent's channels/" — which reads like a bad import and is not one.
	 * Nothing reports it: `resolveTargetByReference` matches on object
	 * identity, its `createRouteFingerprint` fallback returns null for an empty
	 * route set, and a channel contributing no routes is not a discovery error,
	 * so `diagnostics` stays at zero while every dispatched task fails.
	 *
	 * Registering this way is what keeps the hand-off working; if eve gains a
	 * way to register a routeless channel, this goes.
	 */
	routes: [
		POST(
			"/internal/crm/dispatch-only",
			async () => new Response("Not found", { status: 404 }),
		),
	],

	/**
	 * A turn ending is what retires the row.
	 *
	 * The dispatcher cannot do it: `receive` returns a `Session` the moment the
	 * message is accepted, so awaiting it says the work *started*, never that it
	 * finished. Completing there would retire rows before the research ran; not
	 * completing there — which is what the code did — meant nothing retired them
	 * at all, the lease expired, and the row was dispatched again ten minutes
	 * later, forever, resuming the same session and paying for another turn.
	 *
	 * `session.waiting` is the boundary that actually means "this turn is done
	 * and the session is ready for the next message", so it is the one that
	 * closes the task.
	 */
	events: {
		async "session.waiting"(_data, channel) {
			const taskId = taskFromToken(channel.continuationToken);
			if (!taskId) return;

			const subject = await completeTask(taskId, "ran");
			// Null means somebody already closed it — a later turn on the same
			// thread, or the retirement sweep. Not ours to settle.
			if (subject) await settle(subject, EnrichmentStatus.COMPLETE);
		},

		async "turn.failed"(data, channel) {
			const taskId = taskFromToken(channel.continuationToken);
			if (!taskId) return;

			const reason =
				typeof data === "object" && data && "error" in data
					? String((data as { error: unknown }).error)
					: "The research turn failed.";

			// The row is deliberately *not* closed. A failed turn is worth another
			// go, and leaving it open lets the lease expire and the attempt cap
			// decide when to stop — the same path a crashed run takes. Only the
			// record is updated, so the sheet stops claiming somebody is working
			// on it in the meantime; the next claim puts it back to RUNNING.
			const subject = await taskSubject(taskId);
			if (subject) await settle(subject, EnrichmentStatus.FAILED, reason);
		},
	},

	async receive(input, { send }) {
		const taskId =
			typeof input.target?.taskId === "string" ? input.target.taskId : null;

		// The token is the task, which gives retries the behaviour you want for
		// free: a lease that expired mid-run is re-dispatched and *continues* the
		// same durable session rather than starting the research over. A task
		// scheduled fortnightly gets a new id each time, so two runs a fortnight
		// apart correctly share nothing.
		return send(input.message, {
			auth: input.auth,
			continuationToken: taskId
				? taskToken(taskId)
				: `crm:adhoc:${crypto.randomUUID()}`,
		});
	},
});
