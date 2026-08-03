import { canEditOwnedRecord, canReassignOwner, isCrmAdmin } from "@crm/auth";
import {
	ActivityType,
	type Db,
	type DealStage,
	type Priority,
	type Prisma,
	Prisma as PrismaNamespace,
} from "@crm/db";
import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { ActivityStampService } from "../crm/activity-stamp.service";
import {
	DEAL_CHANGE_SELECT,
	type DealChangeSnapshot,
	DealChangeRecorder,
} from "../crm/deal-change.service";
import { fromCents, toCents } from "../crm/values";
import { InjectDatabase } from "../database/database.constants";
import { SagePushService } from "../sage/sage-push.service";
import {
	countsByKey,
	FACET_ALL,
	FACET_UNASSIGNED,
	type ListResult,
	paginate,
	resolveOrderBy,
} from "../trpc/list-input";
import {
	CLOSED_DEAL_STAGES,
	certaintyForStage,
	isClosedStage,
	LOSING_DEAL_STAGES,
	OPEN_DEAL_STAGES,
	weightedFromAmount,
} from "./deal-stage";
import type {
	ClosingWindow,
	DealCreateInput,
	DealListInput,
	DealUpdateInput,
	SetStageInput,
} from "./deals.contracts";
import { CLOSING_WINDOWS } from "./deals.contracts";

/** Facet value for deals/tasks with no priority set. */
const FACET_NONE = "none";

/** Signed-in actor for ownership checks (id + email for admin list). */
export type DealActor = { id: string; email: string };

const OWNER_SELECT = {
	id: true,
	name: true,
	email: true,
	image: true,
} as const;

const COMPANY_SELECT = {
	id: true,
	name: true,
	domain: true,
	iconUrl: true,
	iconDarkUrl: true,
	iconTone: true,
} as const;

const LOSING = new Set<DealStage>(LOSING_DEAL_STAGES);

const SORTABLE: Record<
	string,
	(dir: Prisma.SortOrder) => Prisma.DealOrderByWithRelationInput[]
> = {
	name: (dir) => [{ name: dir }],
	company: (dir) => [{ company: { name: dir } }, { name: "asc" }],
	// Enum order is declaration order in Postgres, which is pipeline order — so
	// sorting by stage reads as "how far along", not alphabetically.
	stage: (dir) => [{ stage: dir }, { expectedCloseDate: "asc" }],
	amount: (dir) => [{ amount: dir }],
	expectedCloseDate: (dir) => [{ expectedCloseDate: dir }],
	createdAt: (dir) => [{ createdAt: dir }],
	owner: (dir) => [{ owner: { name: dir } }, { name: "asc" }],
	lastActivity: (dir) => [{ lastActivityAt: { sort: dir, nulls: "last" } }],
};

@Injectable()
export class DealsService {
	private readonly logger = new Logger(DealsService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly stamp: ActivityStampService,
		private readonly sagePush: SagePushService,
		private readonly dealChanges: DealChangeRecorder,
	) {}

	async list(input: DealListInput) {
		const where = this.buildWhere(input);
		const { skip, take } = paginate(input);

		const [rows, total, facetCounts, openValue] = await Promise.all([
			this.db.deal.findMany({
				where,
				skip,
				take,
				orderBy: resolveOrderBy(input, SORTABLE, [{ createdAt: "desc" }]),
				select: {
					id: true,
					name: true,
					stage: true,
					priority: true,
					amount: true,
					currency: true,
					expectedCloseDate: true,
					closedAt: true,
					sageCrmOpportunityId: true,
					probability: true,
					weightedAmount: true,
					dealType: true,
					sageStage: true,
					sageStatus: true,
					company: { select: COMPANY_SELECT },
					owner: { select: OWNER_SELECT },
					lastActivityAt: true,
					createdAt: true,
				},
			}),
			this.db.deal.count({ where }),
			this.facetCounts(input),
			// Summed in Postgres over the *filtered* set, not the page: a footer
			// that says "$1.2M" for the 25 rows you can see is worse than no
			// number at all.
			this.db.deal.aggregate({
				where: { ...where, stage: { in: [...OPEN_DEAL_STAGES] } },
				_sum: { amount: true, weightedAmount: true },
			}),
		]);

		return {
			rows: rows.map(
				({
					amount,
					weightedAmount,
					expectedCloseDate,
					closedAt,
					lastActivityAt,
					createdAt,
					...row
				}) => ({
					...row,
					amountCents: toCents(amount),
					weightedAmountCents: toCents(weightedAmount),
					expectedCloseDate: expectedCloseDate?.toISOString() ?? null,
					closedAt: closedAt?.toISOString() ?? null,
					lastActivityAt: lastActivityAt?.toISOString() ?? null,
					createdAt: createdAt.toISOString(),
				}),
			),
			total,
			facetCounts,
			/** Open pipeline value across everything matching the filters. */
			openValueCents: toCents(openValue._sum.amount),
			/** Sage-weighted open pipeline (`forecast`) for the same filter set. */
			openWeightedCents: toCents(openValue._sum.weightedAmount),
		} satisfies ListResult<unknown> & {
			openValueCents: number | null;
			openWeightedCents: number | null;
		};
	}

	async byId(id: string) {
		const deal = await this.db.deal.findUnique({
			where: { id },
			select: {
				id: true,
				name: true,
				stage: true,
				stageChangedAt: true,
				priority: true,
				amount: true,
				currency: true,
				expectedCloseDate: true,
				closedAt: true,
				closedReason: true,
				sageCrmOpportunityId: true,
				probability: true,
				weightedAmount: true,
				dealType: true,
				sageStage: true,
				sageStatus: true,
				createdAt: true,
				company: { select: { ...COMPANY_SELECT, industry: true } },
				owner: { select: OWNER_SELECT },
				contacts: {
					select: {
						role: true,
						contact: {
							select: {
								id: true,
								firstName: true,
								lastName: true,
								email: true,
								title: true,
							},
						},
					},
				},
			},
		});

		if (!deal) {
			throw new NotFoundException(`No deal with id ${id}.`);
		}

		const { contacts, amount, weightedAmount, ...rest } = deal;

		return {
			...rest,
			amountCents: toCents(amount),
			weightedAmountCents: toCents(weightedAmount),
			stageChangedAt: deal.stageChangedAt.toISOString(),
			expectedCloseDate: deal.expectedCloseDate?.toISOString() ?? null,
			closedAt: deal.closedAt?.toISOString() ?? null,
			createdAt: deal.createdAt.toISOString(),
			contacts: contacts.map(({ role, contact }) => ({ ...contact, role })),
		};
	}

	async create(input: DealCreateInput, actor: DealActor) {
		const stage = input.stage ?? "DEMO_BOOKED";
		const closed = isClosedStage(stage);
		const now = new Date();
		// You own what you create. Admins may assign someone else at create.
		const ownerId = isCrmAdmin(actor.email) ? input.ownerId : actor.id;
		const probability = certaintyForStage(stage);
		const amount = fromCents(input.amountCents);
		const weightedAmount = weightedFromAmount(amount, probability);

		try {
			const deal = await this.db.deal.create({
				data: {
					name: input.name.trim(),
					companyId: input.companyId,
					ownerId,
					stage,
					stageChangedAt: now,
					closedAt: closed ? now : null,
					amount,
					probability,
					weightedAmount,
					currency: input.currency ?? "USD",
					expectedCloseDate: parseDate(input.expectedCloseDate),
					priority: input.priority ?? null,
				},
				select: { id: true, name: true, companyId: true },
			});

			this.logger.log({ message: "Deal created", dealId: deal.id, stage });

			await this.sagePush.enqueueAndKick("deal", deal.id, actor.id);

			return deal;
		} catch (error) {
			throw this.translateRelations(error);
		}
	}

	async update(id: string, input: DealUpdateInput, actor: DealActor) {
		const existing = await this.db.deal.findUnique({
			where: { id },
			select: {
				id: true,
				...DEAL_CHANGE_SELECT,
			},
		});

		if (!existing) {
			throw new NotFoundException(`No deal with id ${id}.`);
		}

		this.assertCanEdit(actor, existing.ownerId);

		if (input.ownerId !== undefined && input.ownerId !== existing.ownerId) {
			if (!canReassignOwner(actor.email)) {
				throw new ForbiddenException(
					"Only an admin can reassign a deal's owner.",
				);
			}
		}

		const data: Prisma.DealUpdateInput = {};

		if (input.name !== undefined) data.name = input.name.trim();
		if (input.companyId !== undefined) {
			data.company = { connect: { id: input.companyId } };
		}
		if (input.ownerId !== undefined) {
			data.owner = { connect: { id: input.ownerId } };
		}
		if (input.currency !== undefined) data.currency = input.currency;
		if (input.expectedCloseDate !== undefined) {
			data.expectedCloseDate = parseDate(input.expectedCloseDate);
		}
		if (input.priority !== undefined) {
			data.priority = input.priority;
		}

		const nextAmount =
			input.amountCents !== undefined
				? fromCents(input.amountCents)
				: existing.amount === null
					? null
					: existing.amount.toNumber();
		const nextProbability =
			input.probability !== undefined
				? input.probability
				: existing.probability;

		if (input.amountCents !== undefined) {
			data.amount = nextAmount;
		}
		if (input.probability !== undefined) {
			data.probability = nextProbability;
		}
		// Keep weighted in step when amount or certainty changes.
		if (input.amountCents !== undefined || input.probability !== undefined) {
			data.weightedAmount = weightedFromAmount(nextAmount, nextProbability);
		}

		const after: DealChangeSnapshot = {
			stage: existing.stage,
			probability: nextProbability,
			amount: nextAmount,
			expectedCloseDate:
				input.expectedCloseDate !== undefined
					? parseDate(input.expectedCloseDate)
					: existing.expectedCloseDate,
			ownerId: input.ownerId ?? existing.ownerId,
			priority:
				input.priority !== undefined ? input.priority : existing.priority,
			sageStage: existing.sageStage,
		};

		try {
			const updated = await this.db.deal.update({
				where: { id },
				data,
				select: { id: true, name: true },
			});

			await this.dealChanges.recordDiffs({
				dealId: id,
				before: existing,
				after,
				source: "app",
				actorUserId: actor.id,
			});

			if (
				input.name !== undefined ||
				input.amountCents !== undefined ||
				input.probability !== undefined ||
				input.expectedCloseDate !== undefined ||
				input.ownerId !== undefined ||
				input.companyId !== undefined
			) {
				await this.sagePush.enqueueAndKick("deal", id, actor.id);
			}

			return updated;
		} catch (error) {
			throw this.translate(error, id);
		}
	}

	/**
	 * Moves a deal and records that it moved.
	 *
	 * One transaction, because a stage change with no timeline entry is a deal
	 * nobody can explain a week later — and a timeline entry for a change that
	 * did not commit is worse.
	 *
	 * Certainty follows the stage (`STAGE_CERTAINTY`); weighted is recomputed
	 * from amount × certainty when amount is set.
	 */
	async setStage(input: SetStageInput, actor: DealActor) {
		const deal = await this.db.deal.findUnique({
			where: { id: input.id },
			select: {
				id: true,
				companyId: true,
				...DEAL_CHANGE_SELECT,
			},
		});

		if (!deal) {
			throw new NotFoundException(`No deal with id ${input.id}.`);
		}

		this.assertCanEdit(actor, deal.ownerId);

		if (deal.stage === input.stage) {
			return { id: deal.id, stage: deal.stage, changed: false };
		}

		const closedReason = input.closedReason?.trim();
		if (LOSING.has(input.stage) && !closedReason) {
			throw new BadRequestException(
				"Say why it was lost — a closed-lost deal with no reason teaches nobody anything.",
			);
		}

		const now = new Date();
		const closed = isClosedStage(input.stage);
		const probability = certaintyForStage(input.stage);
		const amount = deal.amount === null ? null : deal.amount.toNumber();
		const weightedAmount = weightedFromAmount(amount, probability);

		const [updated] = await this.db.$transaction([
			this.db.deal.update({
				where: { id: input.id },
				data: {
					stage: input.stage,
					stageChangedAt: now,
					closedAt: closed ? now : null,
					closedReason: closed ? (closedReason ?? null) : null,
					probability,
					weightedAmount,
				},
				select: { id: true, stage: true, probability: true },
			}),
			this.db.activity.create({
				data: {
					type: ActivityType.STAGE_CHANGE,
					subject: "Stage changed",
					body: closedReason ?? null,
					occurredAt: now,
					// Stamped with the company as well as the deal, so this shows on
					// the company timeline without a join.
					companyId: deal.companyId,
					dealId: deal.id,
					createdById: actor.id,
					meta: { from: deal.stage, to: input.stage },
				},
			}),
		]);

		await this.dealChanges.recordDiffs({
			dealId: deal.id,
			before: deal,
			after: {
				stage: input.stage,
				probability,
				amount,
				expectedCloseDate: deal.expectedCloseDate,
				ownerId: deal.ownerId,
				priority: deal.priority,
				sageStage: deal.sageStage,
			},
			source: "app",
			actorUserId: actor.id,
			at: now,
		});

		await this.stamp.touch(
			{ companyId: deal.companyId, dealId: deal.id },
			new Date(),
		);

		this.logger.log({
			message: "Deal stage changed",
			dealId: deal.id,
			from: deal.stage,
			to: input.stage,
			probability,
		});

		await this.sagePush.enqueueAndKick("deal", deal.id, actor.id);

		return { ...updated, changed: true };
	}

	private assertCanEdit(actor: DealActor, ownerId: string) {
		if (
			canEditOwnedRecord({
				actingUserId: actor.id,
				actingEmail: actor.email,
				ownerId,
			})
		) {
			return;
		}
		throw new ForbiddenException(
			"Only the deal's owner (or an admin) can change this deal.",
		);
	}

	private searchFilter(q: string): Prisma.DealWhereInput {
		const term = q.trim();
		if (!term) return {};

		return {
			OR: [
				{ name: { contains: term, mode: "insensitive" } },
				{ company: { name: { contains: term, mode: "insensitive" } } },
			],
		};
	}

	private buildWhere(input: DealListInput): Prisma.DealWhereInput {
		const where: Prisma.DealWhereInput = this.searchFilter(input.q);

		if (input.owner !== FACET_ALL) {
			// `Deal.ownerId` is required, so unlike companies and contacts there is
			// no null to match — "unassigned" is a filter that can only ever be
			// empty, and `in: []` says that in Prisma's own terms.
			where.ownerId =
				input.owner === FACET_UNASSIGNED ? { in: [] } : input.owner;
		}

		if (input.status === "open") {
			where.stage = { in: [...OPEN_DEAL_STAGES] };
		} else if (input.status === "closed") {
			where.stage = { in: [...CLOSED_DEAL_STAGES] };
		}

		// An explicit stage wins over the tab: picking "Closed won" while the
		// "Open" tab is selected should show closed-won, not nothing.
		if (input.stage !== FACET_ALL) {
			where.stage = input.stage as DealStage;
		}

		if (input.closing !== FACET_ALL) {
			Object.assign(where, closingFilter(input.closing as ClosingWindow));
		}

		if (input.company !== FACET_ALL) {
			where.companyId = input.company;
		}

		if (input.priority !== FACET_ALL) {
			where.priority =
				input.priority === FACET_NONE ? null : (input.priority as Priority);
		}

		return where;
	}

	private async facetCounts(input: DealListInput) {
		const where = this.searchFilter(input.q);

		const [owners, stages, priorities, ...closingCounts] = await Promise.all([
			this.db.deal.groupBy({ by: ["ownerId"], where, _count: { _all: true } }),
			this.db.deal.groupBy({ by: ["stage"], where, _count: { _all: true } }),
			this.db.deal.groupBy({ by: ["priority"], where, _count: { _all: true } }),
			...CLOSING_WINDOWS.map((window) =>
				this.db.deal.count({ where: { ...where, ...closingFilter(window) } }),
			),
		]);

		const stageCounts = countsByKey(stages, "stage");
		const openCount = OPEN_DEAL_STAGES.reduce(
			(total, stage) => total + (stageCounts[stage] ?? 0),
			0,
		);
		const closedCount = CLOSED_DEAL_STAGES.reduce(
			(total, stage) => total + (stageCounts[stage] ?? 0),
			0,
		);

		return {
			status: { open: openCount, closed: closedCount },
			owner: countsByKey(owners, "ownerId", FACET_UNASSIGNED),
			stage: stageCounts,
			priority: countsByKey(priorities, "priority", FACET_NONE),
			closing: Object.fromEntries(
				CLOSING_WINDOWS.map((window, index) => [
					window,
					closingCounts[index] ?? 0,
				]),
			),
		};
	}

	private translate(error: unknown, id: string): unknown {
		if (
			error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
			error.code === "P2025"
		) {
			return new NotFoundException(`No deal with id ${id}.`);
		}
		return this.translateRelations(error);
	}

	/** A missing company or owner is the caller's mistake, not a 500. */
	private translateRelations(error: unknown): unknown {
		if (
			error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
			(error.code === "P2003" || error.code === "P2025")
		) {
			return new BadRequestException(
				"That company or owner does not exist any more.",
			);
		}
		return error;
	}
}

/**
 * Month boundaries are computed here rather than in SQL so the buckets follow
 * the server's calendar rather than UTC's, which matters on the last day of a
 * month for a team in New York.
 */
function closingFilter(window: ClosingWindow): Prisma.DealWhereInput {
	const now = new Date();
	const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
	const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
	const startOfMonthAfter = new Date(now.getFullYear(), now.getMonth() + 2, 1);

	switch (window) {
		case "overdue":
			// Only open deals can be overdue; a closed deal's date is history.
			return {
				expectedCloseDate: { lt: now },
				stage: { in: [...OPEN_DEAL_STAGES] },
			};
		case "this-month":
			return {
				expectedCloseDate: { gte: startOfMonth, lt: startOfNextMonth },
			};
		case "next-month":
			return {
				expectedCloseDate: { gte: startOfNextMonth, lt: startOfMonthAfter },
			};
		case "later":
			return { expectedCloseDate: { gte: startOfMonthAfter } };
		case "none":
			return { expectedCloseDate: null };
	}
}

function parseDate(value: string | null | undefined): Date | null {
	if (value === null || value === undefined || value === "") return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new BadRequestException(`"${value}" is not a date.`);
	}
	return date;
}
