import { type Db } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import {
	type CompanyPushInput,
	type ContactPushInput,
	type DealPushInput,
	toSageCompanyFields,
	toSageOpportunityFields,
	toSagePersonFields,
} from "./sage.mappings";
import { withSageSession } from "./sage-session";
import { SageSoapClient } from "./sage-soap.client";

/** Local entities that can be pushed, parent-before-child (company first). */
const PUSH_ENTITIES = ["company", "contact", "deal"] as const;
export type PushEntity = (typeof PUSH_ENTITIES)[number];
type PushOp = "create" | "update";

/** Attempts before a row parks as `failed` (the user's "max 3 retries"). */
const MAX_ATTEMPTS = 3;
/** How many rows one flush drains — keeps a session short. */
const DEFAULT_FLUSH_LIMIT = 50;

export type SagePushOutcome =
	| "ok"
	| "not-configured"
	| "auth-failed"
	| "busy";

export type SagePushSummary = {
	outcome: SagePushOutcome;
	reason?: string;
	processed: number;
	pushed: number;
	failed: number;
	skipped: number;
};

/**
 * Sage CRM push — the write direction (plan §5 item 7 / Phase G).
 *
 * A human UI create/update enqueues a `SageOutbox` row; `flush()` drains it
 * inside the one global Sage session (`withSageSession`), SOAP `add`/`update`s
 * the record, then stamps `sagePushedAt` (+ the new `sageCrm*Id` on a create)
 * so the next pull skips our own write. Mechanical only, mirroring the pull —
 * no enrichment, no agent triggers. Local edits win: no pre-read conflict
 * check, the echo-guard makes the pull ignore the round-trip.
 */
@Injectable()
export class SagePushService {
	private readonly logger = new Logger(SagePushService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly soap: SageSoapClient,
	) {}

	/**
	 * Queue a local record for push. Deduped: one pending row per record — a
	 * second edit before the flush updates the existing row. Never throws; a
	 * failure to enqueue must not break the user's save.
	 */
	async enqueue(
		entity: PushEntity,
		localId: string,
		requestedById?: string | null,
	): Promise<void> {
		if (!this.soap.isConfigured()) return;
		try {
			const op = await this.currentOp(entity, localId);
			if (!op) return; // row vanished

			const existing = await this.db.sageOutbox.findFirst({
				where: { entity, localId, status: "pending" },
				select: { id: true, op: true },
			});
			if (existing) {
				// Keep a pending create as a create even if the row now looks
				// updatable — Sage still does not have it.
				const nextOp = existing.op === "create" ? "create" : op;
				await this.db.sageOutbox.update({
					where: { id: existing.id },
					data: {
						op: nextOp,
						requestedById: requestedById ?? undefined,
						nextAttemptAt: null,
					},
				});
				return;
			}

			await this.db.sageOutbox.create({
				data: { entity, localId, op, requestedById: requestedById ?? null },
			});
		} catch (error) {
			this.logger.warn({
				message: "Sage push enqueue failed (ignored)",
				entity,
				localId,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/**
	 * Enqueue, then kick a best-effort immediate flush without blocking the
	 * caller's response. Failures fall to the next flush / cron retry.
	 */
	async enqueueAndKick(
		entity: PushEntity,
		localId: string,
		requestedById?: string | null,
	): Promise<void> {
		await this.enqueue(entity, localId, requestedById);
		void this.flush().then(
			(summary) => {
				if (
					summary.outcome !== "ok" &&
					summary.outcome !== "busy" &&
					summary.outcome !== "not-configured"
				) {
					this.logger.warn({
						message: "Sage push kick failed",
						entity,
						localId,
						outcome: summary.outcome,
						reason: summary.reason,
					});
				}
			},
			(error: unknown) => {
				this.logger.warn({
					message: "Sage push kick threw (ignored)",
					entity,
					localId,
					error: error instanceof Error ? error.message : String(error),
				});
			},
		);
	}

	/**
	 * Drain pending outbox rows to Sage inside the single session.
	 *
	 * Returns `busy` when another Sage holder (pull, backfill, another flush)
	 * owns the lock — the caller simply tries again later. Safe to call from the
	 * best-effort immediate push and from the nightly cron.
	 */
	async flush(limit = DEFAULT_FLUSH_LIMIT): Promise<SagePushSummary> {
		const empty: SagePushSummary = {
			outcome: "ok",
			processed: 0,
			pushed: 0,
			failed: 0,
			skipped: 0,
		};
		if (!this.soap.isConfigured()) {
			return { ...empty, outcome: "not-configured" };
		}

		const due = await this.dueRows(limit);
		if (due.length === 0) return empty;

		const result = await withSageSession(this.db, this.soap, () =>
			this.drain(due),
		);
		if (result.outcome === "busy") return { ...empty, outcome: "busy" };
		return result.value;
	}

	/** Pending rows whose backoff has elapsed, parent-before-child ordered. */
	private async dueRows(limit: number) {
		const now = new Date();
		const rows = await this.db.sageOutbox.findMany({
			where: {
				status: "pending",
				OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
			},
			orderBy: { createdAt: "asc" },
			take: limit,
		});
		return rows.toSorted(
			(a, b) => entityRank(a.entity) - entityRank(b.entity),
		);
	}

	private async drain(
		rows: Awaited<ReturnType<SagePushService["dueRows"]>>,
	): Promise<SagePushSummary> {
		let pushed = 0;
		let failed = 0;
		let skipped = 0;

		for (const row of rows) {
			const outcome = await this.processRow(
				row.entity as PushEntity,
				row.localId,
			);

			if (outcome.kind === "auth-failed") {
				// Never retry-spam a logon (it can lock the service account).
				return {
					outcome: "auth-failed",
					reason: outcome.reason,
					processed: pushed + failed + skipped,
					pushed,
					failed,
					skipped,
				};
			}

			if (outcome.kind === "ok") {
				await this.db.sageOutbox.update({
					where: { id: row.id },
					data: {
						status: "done",
						processedAt: new Date(),
						lastError: null,
					},
				});
				pushed += 1;
				continue;
			}

			if (outcome.kind === "skip") {
				await this.db.sageOutbox.update({
					where: { id: row.id },
					data: { status: "done", processedAt: new Date() },
				});
				skipped += 1;
				continue;
			}

			// failure — retryable (bump + backoff) or terminal (park as failed)
			const attempts = row.attempts + 1;
			const park = !outcome.retryable || attempts >= MAX_ATTEMPTS;
			await this.db.sageOutbox.update({
				where: { id: row.id },
				data: {
					attempts,
					lastError: outcome.reason,
					status: park ? "failed" : "pending",
					nextAttemptAt: park ? null : backoff(attempts),
				},
			});
			failed += 1;
		}

		return {
			outcome: "ok",
			processed: pushed + failed + skipped,
			pushed,
			failed,
			skipped,
		};
	}

	/** Push one row; the caller records the result on the outbox row. */
	private async processRow(
		entity: PushEntity,
		localId: string,
	): Promise<RowOutcome> {
		switch (entity) {
			case "company":
				return this.pushCompany(localId);
			case "contact":
				return this.pushContact(localId);
			case "deal":
				return this.pushDeal(localId);
		}
	}

	private async pushCompany(localId: string): Promise<RowOutcome> {
		const company = await this.db.company.findUnique({
			where: { id: localId },
			select: { id: true, name: true, website: true, sageCrmCompanyId: true },
		});
		if (!company) return { kind: "skip" };

		const op: PushOp = company.sageCrmCompanyId ? "update" : "create";
		const input: CompanyPushInput = {
			sageCrmCompanyId: company.sageCrmCompanyId,
			name: company.name,
			website: company.website,
		};
		const fields = toSageCompanyFields(input, op);

		if (op === "update") {
			const res = await this.soap.update("company", fields);
			return this.afterUpdate(res, () => this.stampCompany(localId));
		}
		const res = await this.soap.add("company", fields);
		return this.afterAdd(res, (id) => this.stampCompany(localId, id));
	}

	private async pushContact(localId: string): Promise<RowOutcome> {
		const contact = await this.db.contact.findUnique({
			where: { id: localId },
			select: {
				id: true,
				firstName: true,
				lastName: true,
				title: true,
				sageCrmContactId: true,
				company: { select: { sageCrmCompanyId: true } },
			},
		});
		if (!contact) return { kind: "skip" };

		const op: PushOp = contact.sageCrmContactId ? "update" : "create";
		const parentSageId = contact.company?.sageCrmCompanyId ?? null;

		// A create needs the parent company in Sage first. If it is not there yet
		// (its own outbox row has not drained), retry on the next flush.
		if (op === "create" && !parentSageId) {
			return {
				kind: "failed",
				retryable: true,
				reason: "parent company not yet in Sage",
			};
		}

		const input: ContactPushInput = {
			sageCrmContactId: contact.sageCrmContactId,
			firstName: contact.firstName,
			lastName: contact.lastName,
			title: contact.title,
			sageCrmCompanyId: parentSageId,
		};
		const fields = toSagePersonFields(input, op);

		if (op === "update") {
			const res = await this.soap.update("person", fields);
			return this.afterUpdate(res, () => this.stampContact(localId));
		}
		const res = await this.soap.add("person", fields);
		return this.afterAdd(res, (id) => this.stampContact(localId, id));
	}

	private async pushDeal(localId: string): Promise<RowOutcome> {
		const deal = await this.db.deal.findUnique({
			where: { id: localId },
			select: {
				id: true,
				name: true,
				amount: true,
				probability: true,
				stage: true,
				sageStage: true,
				sageStatus: true,
				expectedCloseDate: true,
				sageCrmOpportunityId: true,
				company: { select: { sageCrmCompanyId: true } },
				owner: { select: { email: true } },
				contacts: {
					where: { contact: { sageCrmContactId: { not: null } } },
					select: { contact: { select: { sageCrmContactId: true } } },
					take: 1,
				},
			},
		});
		if (!deal) return { kind: "skip" };

		const op: PushOp = deal.sageCrmOpportunityId ? "update" : "create";
		const parentSageId = deal.company?.sageCrmCompanyId ?? null;
		if (op === "create" && !parentSageId) {
			return {
				kind: "failed",
				retryable: true,
				reason: "parent company not yet in Sage",
			};
		}

		const input: DealPushInput = {
			sageCrmOpportunityId: deal.sageCrmOpportunityId,
			name: deal.name,
			amount: deal.amount?.toString() ?? null,
			probability: deal.probability,
			stage: deal.stage,
			sageStage: deal.sageStage,
			sageStatus: deal.sageStatus,
			expectedCloseDate: deal.expectedCloseDate,
			ownerEmail: deal.owner?.email ?? null,
			sageCrmCompanyId: parentSageId,
			sageCrmPrimaryPersonId:
				deal.contacts[0]?.contact.sageCrmContactId ?? null,
		};
		const fields = toSageOpportunityFields(input, op);

		if (op === "update") {
			const res = await this.soap.update("opportunity", fields);
			return this.afterUpdate(res, () => this.stampDeal(localId));
		}
		const res = await this.soap.add("opportunity", fields);
		return this.afterAdd(res, (id) => this.stampDeal(localId, id));
	}

	// --- result plumbing ----------------------------------------------------

	private async afterUpdate(
		res: Awaited<ReturnType<SageSoapClient["update"]>>,
		stamp: () => Promise<void>,
	): Promise<RowOutcome> {
		if (res.outcome === "ok") {
			await stamp();
			return { kind: "ok" };
		}
		return toRowOutcome(res);
	}

	private async afterAdd(
		res: Awaited<ReturnType<SageSoapClient["add"]>>,
		stamp: (newSageId: string) => Promise<void>,
	): Promise<RowOutcome> {
		if (res.outcome === "ok") {
			await stamp(res.data.id);
			return { kind: "ok" };
		}
		return toRowOutcome(res);
	}

	private async stampCompany(localId: string, newSageId?: string) {
		await this.db.company.update({
			where: { id: localId },
			data: {
				sagePushedAt: new Date(),
				...(newSageId ? { sageCrmCompanyId: newSageId } : {}),
			},
		});
	}

	private async stampContact(localId: string, newSageId?: string) {
		await this.db.contact.update({
			where: { id: localId },
			data: {
				sagePushedAt: new Date(),
				...(newSageId ? { sageCrmContactId: newSageId } : {}),
			},
		});
	}

	private async stampDeal(localId: string, newSageId?: string) {
		await this.db.deal.update({
			where: { id: localId },
			data: {
				sagePushedAt: new Date(),
				...(newSageId ? { sageCrmOpportunityId: newSageId } : {}),
			},
		});
	}

	/** Whether the local row already has a Sage id (update) or not (create). */
	private async currentOp(
		entity: PushEntity,
		localId: string,
	): Promise<PushOp | null> {
		if (entity === "company") {
			const row = await this.db.company.findUnique({
				where: { id: localId },
				select: { sageCrmCompanyId: true },
			});
			if (!row) return null;
			return row.sageCrmCompanyId ? "update" : "create";
		}
		if (entity === "contact") {
			const row = await this.db.contact.findUnique({
				where: { id: localId },
				select: { sageCrmContactId: true },
			});
			if (!row) return null;
			return row.sageCrmContactId ? "update" : "create";
		}
		const row = await this.db.deal.findUnique({
			where: { id: localId },
			select: { sageCrmOpportunityId: true },
		});
		if (!row) return null;
		return row.sageCrmOpportunityId ? "update" : "create";
	}
}

/** The outcome of pushing one row, before it is recorded on the outbox. */
type RowOutcome =
	| { kind: "ok" }
	| { kind: "skip" }
	| { kind: "auth-failed"; reason: string }
	| { kind: "failed"; retryable: boolean; reason: string };

/** Map a SOAP result (non-ok) onto a row outcome. */
function toRowOutcome(res: {
	outcome: "not-configured" | "auth-failed" | "failed";
	reason: string;
	retryable?: boolean;
}): RowOutcome {
	if (res.outcome === "auth-failed") {
		return { kind: "auth-failed", reason: res.reason };
	}
	if (res.outcome === "not-configured") {
		return { kind: "failed", retryable: false, reason: res.reason };
	}
	return { kind: "failed", retryable: res.retryable ?? true, reason: res.reason };
}

function entityRank(entity: string): number {
	const index = (PUSH_ENTITIES as readonly string[]).indexOf(entity);
	return index === -1 ? PUSH_ENTITIES.length : index;
}

/** Exponential-ish backoff so a transient failure retries later, not instantly. */
function backoff(attempts: number): Date {
	const minutes = 2 ** attempts; // 2, 4, 8 …
	return new Date(Date.now() + minutes * 60_000);
}
