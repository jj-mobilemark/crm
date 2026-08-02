import type { Db } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

/**
 * How the API tells the agent something happened.
 *
 * This is the whole of what Nest knows about enrichment, and it is deliberately
 * not enrichment: it reports an event and states why it might matter. No vendor
 * client, no scoring, no decision about a person. What the agent does with
 * "this company was just created" — whether to look it up now, later, or at all
 * — is the agent's business.
 *
 * A row rather than an HTTP call to the agent. The dispatcher already leases
 * work from this table, so a row *is* the message, and it survives the agent
 * being down, redeployed, or slower than the request that produced it. An
 * outbound call from a request handler would have to be awaited (slow), fired
 * and forgotten (lost), or queued — and queued is this.
 */
@Injectable()
export class AgentTriggerService {
	private readonly logger = new Logger(AgentTriggerService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	/** A company we have never seen. Nothing on it but a domain. */
	async companyCreated(
		companyId: string,
		reason = "New company",
	): Promise<void> {
		await this.enqueue({
			companyId,
			kind: "company-profile",
			reason,
			priority: 10,
			budget: 4,
		});
	}

	/** A rep pressed a button and is watching. */
	async companyRequested(companyId: string, reason: string): Promise<void> {
		await this.enqueue({
			companyId,
			kind: "company-profile",
			reason,
			// Somebody is looking at the screen, so this goes to the front.
			priority: 100,
			budget: 8,
		});
	}

	/**
	 * A contact arrived from a sync knowing only an address.
	 *
	 * The old path called an enrichment service here and it fired only when the
	 * name looked derived. That test now lives with the agent, because "is this
	 * name a placeholder" is a judgement about a person.
	 */
	async contactCreated(contactId: string, reason: string): Promise<void> {
		await this.enqueue({
			contactId,
			kind: "identify",
			reason,
			priority: 20,
			budget: 4,
		});
	}

	/** A meeting with someone we do not know yet, happening soon. */
	async meetingSoon(contactId: string, when: Date): Promise<void> {
		await this.enqueue({
			contactId,
			kind: "meeting-prep",
			reason: `Meeting on ${when.toDateString()} with someone we know nothing about`,
			// Ahead of everything: the deadline is real and it is tomorrow.
			priority: 200,
			budget: 10,
		});
	}

	/**
	 * The daily sweep for one rep's mailbox and pipeline.
	 *
	 * Per-rep rather than per-record — `userId` is what dedupes it, the same
	 * way `contactId` dedupes an identify task. One outstanding sweep per rep
	 * at a time; a fresh mailbox tick does not queue a second one.
	 */
	async followupsDue(userId: string, reason: string): Promise<void> {
		await this.enqueue({
			userId,
			kind: "followups",
			reason,
			priority: 5,
			budget: 6,
		});
	}

	private async enqueue(task: {
		contactId?: string;
		companyId?: string;
		userId?: string;
		kind: string;
		reason: string;
		priority: number;
		budget: number;
	}): Promise<void> {
		try {
			// Nothing is queued twice for the same subject and kind while a run is
			// still outstanding — a company saved three times in a minute is one
			// piece of work, not three.
			const pending = await this.db.agentTask.findFirst({
				where: {
					kind: task.kind,
					finishedAt: null,
					...(task.contactId ? { contactId: task.contactId } : {}),
					...(task.companyId ? { companyId: task.companyId } : {}),
					...(task.userId ? { userId: task.userId } : {}),
				},
				select: { id: true },
			});

			if (pending) return;

			await this.db.agentTask.create({
				data: {
					contactId: task.contactId ?? null,
					companyId: task.companyId ?? null,
					userId: task.userId ?? null,
					kind: task.kind,
					reason: task.reason,
					priority: task.priority,
					budget: task.budget,
					dueAt: new Date(),
				},
			});

			this.logger.log({
				message: "Agent task queued",
				kind: task.kind,
				contactId: task.contactId,
				companyId: task.companyId,
				userId: task.userId,
			});
		} catch (error) {
			// Never fail the request that caused it. Enrichment has never been on a
			// request path and this is not the moment to put it there.
			this.logger.error(
				{ message: "Could not queue agent task", kind: task.kind },
				error instanceof Error ? error.stack : String(error),
			);
		}
	}
}
