import {
	type ContactBriefSections,
	type Db,
	type FactEvidence,
	FactStatus,
	type Prisma,
	Prisma as PrismaNamespace,
	RecordSource,
} from "@crm/db";
import {
	ConflictException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { AgentQueueService } from "../agent/agent-queue.service";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { CompanyDirectoryService } from "../companies/company-directory.service";
import { blankToNull, toCents } from "../crm/values";
import { InjectDatabase } from "../database/database.constants";
import { SagePushService } from "../sage/sage-push.service";
import {
	countsByKey,
	FACET_ALL,
	FACET_UNASSIGNED,
	type ListResult,
	ownerFilter,
	paginate,
	resolveOrderBy,
} from "../trpc/list-input";
import type {
	ContactCreateInput,
	ContactListInput,
	ContactUpdateInput,
	FactDecisionInput,
} from "./contacts.contracts";

/** Signed-in actor for Sage push attribution (human UI only). */
export type ContactActor = { id: string };

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
	logoUrl: true,
	sageCrmCompanyId: true,
	sage100CustomerNo: true,
	sage100ArDivisionNo: true,
} as const;

/** The facet value for a contact who works nowhere we know of. */
const NO_COMPANY = "none";

/**
 * Which `Contact` column an accepted fact writes through to.
 *
 * The agent's `facts.ts` holds the same map, because it is the one deciding
 * what a field means; this half only needs to know where an accepted value
 * lands. Fields absent from here (`seniority`, `employer`, `location`) have no
 * column — they are read straight off the fact by the background panel.
 */
const FACT_COLUMNS: Record<string, string | undefined> = {
	title: "title",
	linkedinUrl: "linkedinUrl",
	twitterUrl: "twitterUrl",
	githubUrl: "githubUrl",
};

export type ContactRow = {
	id: string;
	firstName: string;
	lastName: string | null;
	email: string | null;
	title: string | null;
	/** Our mirrored copy, never LinkedIn's expiring CDN URL. */
	imageUrl: string | null;
	/** Sage CRM eware person id, when this row was pulled from Sage. */
	sageCrmContactId: string | null;
	company: {
		id: string;
		name: string;
		domain: string | null;
		iconUrl: string | null;
		iconDarkUrl: string | null;
		iconTone: string | null;
		logoUrl: string | null;
		sageCrmCompanyId: string | null;
		sage100CustomerNo: string | null;
		sage100ArDivisionNo: string | null;
	} | null;
	owner: {
		id: string;
		name: string;
		email: string;
		image: string | null;
	} | null;
	lastActivityAt: string | null;
	createdAt: string;
};

/**
 * Orderings are arrays so every column can carry a tiebreak: without one,
 * everybody at the same company comes back in whatever order Postgres feels
 * like, and the order changes between pages of the same query.
 */
const SORTABLE: Record<
	string,
	(dir: Prisma.SortOrder) => Prisma.ContactOrderByWithRelationInput[]
> = {
	// Surname first — a list of people sorted by first name is a list nobody can
	// scan.
	name: (dir) => [{ lastName: dir }, { firstName: dir }],
	email: (dir) => [{ email: dir }],
	title: (dir) => [{ title: dir }, { lastName: "asc" }],
	company: (dir) => [{ company: { name: dir } }, { lastName: "asc" }],
	createdAt: (dir) => [{ createdAt: dir }],
	owner: (dir) => [{ owner: { name: dir } }, { lastName: "asc" }],
	lastActivity: (dir) => [{ lastActivityAt: { sort: dir, nulls: "last" } }],
};

@Injectable()
export class ContactsService {
	private readonly logger = new Logger(ContactsService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly companies: CompanyDirectoryService,
		private readonly agent: AgentTriggerService,
		private readonly queue: AgentQueueService,
		private readonly sagePush: SagePushService,
	) {}

	async list(input: ContactListInput): Promise<ListResult<ContactRow>> {
		const where = this.buildWhere(input);
		const { skip, take } = paginate(input);

		const [rows, total, facetCounts] = await Promise.all([
			this.db.contact.findMany({
				where,
				skip,
				take,
				orderBy: resolveOrderBy(input, SORTABLE, [{ createdAt: "desc" }]),
				select: {
					id: true,
					firstName: true,
					lastName: true,
					email: true,
					title: true,
					imageUrl: true,
					source: true,
					sageCrmContactId: true,
					company: { select: COMPANY_SELECT },
					owner: { select: OWNER_SELECT },
					lastActivityAt: true,
					createdAt: true,
				},
			}),
			this.db.contact.count({ where }),
			this.facetCounts(input),
		]);

		return {
			rows: rows.map((row) => ({
				...row,
				lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
				createdAt: row.createdAt.toISOString(),
			})),
			total,
			facetCounts,
		};
	}

	async byId(id: string) {
		const contact = await this.db.contact.findUnique({
			where: { id },
			select: {
				id: true,
				firstName: true,
				lastName: true,
				email: true,
				phone: true,
				title: true,
				linkedinUrl: true,
				twitterUrl: true,
				githubUrl: true,
				imageUrl: true,
				enrichmentStatus: true,
				enrichmentError: true,
				sageCrmContactId: true,
				createdAt: true,
				brief: {
					select: {
						narrative: true,
						sections: true,
						score: true,
						sourceUrl: true,
						refreshedAt: true,
					},
				},
				// Applied facts are the provenance behind values already on the
				// record; proposed ones are suggestions the sheet offers. Dismissed
				// and superseded stay out of the read path — they are history, and
				// the timeline is where history belongs.
				facts: {
					where: { status: { in: [FactStatus.APPLIED, FactStatus.PROPOSED] } },
					orderBy: { observedAt: "desc" },
					select: {
						id: true,
						field: true,
						value: true,
						score: true,
						band: true,
						evidence: true,
						method: true,
						sourceUrl: true,
						status: true,
						observedAt: true,
					},
				},
				company: {
					select: { ...COMPANY_SELECT, industry: true, primaryContactId: true },
				},
				owner: { select: OWNER_SELECT },
				deals: {
					select: {
						role: true,
						deal: {
							select: {
								id: true,
								name: true,
								stage: true,
								amount: true,
								currency: true,
								expectedCloseDate: true,
								owner: { select: OWNER_SELECT },
							},
						},
					},
				},
			},
		});

		if (!contact) {
			throw new NotFoundException(`No contact with id ${id}.`);
		}

		const relationship = await this.relationship(
			id,
			contact.company?.id ?? null,
		);

		const { deals, createdAt, brief, facts, company, ...rest } = contact;

		return {
			...rest,
			company,
			/** Whether the agent has this person on its list — see `AgentQueueService`. */
			queued: await this.queue.isQueued({ contactId: id }),
			createdAt: createdAt.toISOString(),
			brief: brief
				? {
						...brief,
						sections: brief.sections as ContactBriefSections,
						refreshedAt: brief.refreshedAt.toISOString(),
					}
				: null,
			facts: facts.map((fact) => ({
				...fact,
				evidence: fact.evidence as FactEvidence[],
				observedAt: fact.observedAt.toISOString(),
			})),
			/** What we have actually said to each other. */
			relationship,
			/** True when this is the person to call at their company. */
			isPrimaryContact: company?.primaryContactId === contact.id,
			deals: deals.map(({ role, deal }) => ({
				...deal,
				role,
				amount: undefined,
				amountCents: toCents(deal.amount),
				expectedCloseDate: deal.expectedCloseDate?.toISOString() ?? null,
			})),
		};
	}

	/**
	 * Contact pickers (sequence enroll, etc.).
	 *
	 * Capped at 100 and searchable — same shape as `companies.options`.
	 * Prefers contacts that have an email (required for sequences).
	 */
	async options(q: string) {
		return this.db.contact.findMany({
			where: {
				...this.searchFilter(q),
				email: { not: null },
			},
			select: {
				id: true,
				firstName: true,
				lastName: true,
				email: true,
				company: { select: { id: true, name: true } },
			},
			orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
			take: 100,
		});
	}

	async create(input: ContactCreateInput, actor?: ContactActor) {
		return this.createContact(
			input,
			{
				source: undefined,
				identifyReason: "Added by a rep, with nothing on the record yet",
			},
			actor,
		);
	}

	/**
	 * Approve path from the Screening Room: source EMAIL, agent identify task,
	 * email backfill, and a best-effort Sage person create when the parent
	 * company is already in Sage CRM.
	 */
	async createFromScreening(input: {
		firstName: string;
		lastName?: string;
		email: string;
		companyId?: string | null;
		preferDomainCompany?: boolean;
		ownerId: string;
	}): Promise<{ id: string; firstName: string; lastName: string | null; sagePushQueued: boolean }> {
		const contact = await this.createContact(
			{
				firstName: input.firstName,
				lastName: input.lastName,
				email: input.email,
				companyId: input.companyId,
				ownerId: input.ownerId,
			},
			{
				source: RecordSource.EMAIL,
				identifyReason: "approved in screening room",
				softMatchCompany: input.preferDomainCompany ? false : true,
				sagePush: "if-company-in-sage",
			},
			{ id: input.ownerId },
		);
		return contact;
	}

	private async createContact(
		input: ContactCreateInput,
		options: {
			source: RecordSource | undefined;
			identifyReason: string;
			/** Soft-match in companyForEmail when no companyId. Default true. */
			softMatchCompany?: boolean;
			/**
			 * `if-company-in-sage` — Screening Approve: enqueue person create when
			 * the parent has a Sage CRM id and no local Sage-linked twin.
			 * Failures never fail the local create (outbox enqueue is best-effort).
			 */
			sagePush?: "if-company-in-sage";
		},
		actor?: ContactActor,
	): Promise<{
		id: string;
		firstName: string;
		lastName: string | null;
		sagePushQueued: boolean;
	}> {
		const email = blankToNull(input.email ?? "");

		if (email) {
			const existing = await this.db.contact.findUnique({
				where: { email },
				select: { id: true, firstName: true, lastName: true },
			});
			if (existing) {
				throw new ConflictException(
					`${[existing.firstName, existing.lastName].filter(Boolean).join(" ")} already uses ${email}.`,
				);
			}
		}

		// A work address tells us where someone works. Awaited rather than queued,
		// unlike company enrichment: the contact should arrive already attached to
		// the right company, not attach itself a few seconds later.
		const companyId =
			input.companyId ??
			(email
				? await this.companies.companyForEmail(email, {
						// Same rule as the sync: a company conjured out of somebody's
						// action belongs to them, not to nobody.
						ownerId: input.ownerId,
						softMatch: options.softMatchCompany !== false,
					})
				: null);

		const contact = await this.db.contact.create({
			data: {
				firstName: input.firstName.trim(),
				lastName: blankToNull(input.lastName ?? ""),
				email,
				phone: blankToNull(input.phone ?? ""),
				title: blankToNull(input.title ?? ""),
				companyId,
				ownerId: input.ownerId ?? null,
				...(options.source ? { source: options.source } : {}),
			},
			select: {
				id: true,
				firstName: true,
				lastName: true,
				companyId: true,
			},
		});

		this.logger.log({ message: "Contact created", contactId: contact.id });

		await this.agent.contactCreated(contact.id, options.identifyReason);

		// Mechanical: queue a targeted Graph import of recent mail with this
		// address. The Microsoft sync tick (or Sync now) drains the queue.
		if (email) {
			await this.enqueueEmailBackfill(email, input.ownerId ?? null);
		}

		let sagePushQueued = false;

		// Human UI MANUAL creates always enqueue. Screening Approve enqueues when
		// the parent company is already in Sage and no Sage-linked twin exists.
		if (actor && !options.source) {
			await this.sagePush.enqueueAndKick("contact", contact.id, actor.id);
			sagePushQueued = true;
		} else if (actor && options.sagePush === "if-company-in-sage") {
			sagePushQueued = await this.enqueueScreeningSagePush({
				contactId: contact.id,
				actorId: actor.id,
				firstName: contact.firstName,
				lastName: contact.lastName,
				companyId: contact.companyId,
			});
		}

		return {
			id: contact.id,
			firstName: contact.firstName,
			lastName: contact.lastName,
			sagePushQueued,
		};
	}

	/**
	 * Best-effort Sage person create after Screening Approve.
	 *
	 * Requires parent `sageCrmCompanyId` (SOAP person create needs it). Skips
	 * when a same-name Sage-linked contact already sits on that company, so we
	 * do not invent a second person. Never throws.
	 */
	private async enqueueScreeningSagePush(input: {
		contactId: string;
		actorId: string;
		firstName: string;
		lastName: string | null;
		companyId: string | null;
	}): Promise<boolean> {
		if (!input.companyId) return false;

		try {
			const company = await this.db.company.findUnique({
				where: { id: input.companyId },
				select: {
					id: true,
					name: true,
					sageCrmCompanyId: true,
					sage100CustomerNo: true,
				},
			});
			if (!company?.sageCrmCompanyId) {
				this.logger.log({
					message:
						"Screening Sage push skipped — parent company has no Sage CRM id",
					contactId: input.contactId,
					companyId: input.companyId,
				});
				return false;
			}

			const twin = await this.db.contact.findFirst({
				where: {
					companyId: input.companyId,
					id: { not: input.contactId },
					sageCrmContactId: { not: null },
					firstName: { equals: input.firstName, mode: "insensitive" },
					...(input.lastName
						? { lastName: { equals: input.lastName, mode: "insensitive" } }
						: { OR: [{ lastName: null }, { lastName: "" }] }),
				},
				select: { id: true, sageCrmContactId: true, email: true },
			});
			if (twin) {
				this.logger.log({
					message:
						"Screening Sage push skipped — Sage-linked contact with same name already at company",
					contactId: input.contactId,
					twinId: twin.id,
					sageCrmContactId: twin.sageCrmContactId,
					companyId: input.companyId,
					hasSage100: Boolean(company.sage100CustomerNo),
				});
				return false;
			}

			await this.sagePush.enqueueAndKick(
				"contact",
				input.contactId,
				input.actorId,
			);
			this.logger.log({
				message: "Screening contact queued for Sage push",
				contactId: input.contactId,
				companyId: input.companyId,
				sageCrmCompanyId: company.sageCrmCompanyId,
				hasSage100: Boolean(company.sage100CustomerNo),
			});
			return true;
		} catch (error) {
			this.logger.warn({
				message: "Screening Sage push enqueue failed (ignored)",
				contactId: input.contactId,
				error: error instanceof Error ? error.message : String(error),
			});
			return false;
		}
	}

	async update(id: string, input: ContactUpdateInput, actor?: ContactActor) {
		const data: Prisma.ContactUpdateInput = {};

		if (input.firstName !== undefined) data.firstName = input.firstName.trim();
		if (input.lastName !== undefined)
			data.lastName = blankToNull(input.lastName);
		if (input.email !== undefined) data.email = blankToNull(input.email);
		if (input.phone !== undefined) data.phone = blankToNull(input.phone);
		if (input.title !== undefined) data.title = blankToNull(input.title);
		if (input.linkedinUrl !== undefined) {
			data.linkedinUrl = blankToNull(input.linkedinUrl);
		}
		if (input.twitterUrl !== undefined) {
			data.twitterUrl = blankToNull(input.twitterUrl);
		}
		if (input.githubUrl !== undefined) {
			data.githubUrl = blankToNull(input.githubUrl);
		}
		if (input.companyId !== undefined) {
			data.company = input.companyId
				? { connect: { id: input.companyId } }
				: { disconnect: true };
		}
		if (input.ownerId !== undefined) {
			data.owner = input.ownerId
				? { connect: { id: input.ownerId } }
				: { disconnect: true };
		}

		const previous =
			input.email !== undefined
				? await this.db.contact.findUnique({
						where: { id },
						select: { email: true, ownerId: true },
					})
				: null;

		try {
			const updated = await this.db.contact.update({
				where: { id },
				data,
				select: { id: true, firstName: true, lastName: true, email: true },
			});

			if (
				actor &&
				(input.firstName !== undefined ||
					input.lastName !== undefined ||
					input.title !== undefined ||
					input.companyId !== undefined)
			) {
				await this.sagePush.enqueueAndKick("contact", id, actor.id);
			}

			const nextEmail = updated.email;
			const previousEmail = previous?.email ?? null;
			if (
				nextEmail &&
				input.email !== undefined &&
				nextEmail !== previousEmail
			) {
				await this.enqueueEmailBackfill(
					nextEmail,
					input.ownerId ?? previous?.ownerId ?? null,
				);
			}

			return {
				id: updated.id,
				firstName: updated.firstName,
				lastName: updated.lastName,
			};
		} catch (error) {
			throw this.translate(error, id);
		}
	}

	/**
	 * Upsert a PENDING backfill for an address.
	 *
	 * Re-adding the same address (or changing onto one that already ran) resets
	 * the row to PENDING so the next sync tick re-imports. Idempotent storage
	 * still rests on `rfcMessageId`.
	 */
	private async enqueueEmailBackfill(
		address: string,
		requestedById: string | null,
	): Promise<void> {
		const normalised = address.trim().toLowerCase();
		if (!normalised) return;

		await this.db.emailBackfill.upsert({
			where: { address: normalised },
			create: {
				address: normalised,
				requestedById,
				status: "PENDING",
			},
			update: {
				requestedById,
				status: "PENDING",
				error: null,
				finishedAt: null,
			},
		});
	}

	/**
	 * What we already know from our own mailbox and calendar.
	 *
	 * The one block on this sheet no CRM that buys its data can render: how many
	 * emails, whether they have ever actually replied, when we last heard from
	 * them, what is in the diary, and who else we know at the same company.
	 *
	 * Counts and dates only — the bodies stay out of the API. The agent reads
	 * those (they are the best evidence we have) but the browser has no use for
	 * them here, and shipping a thread into a record payload is how message
	 * content ends up somewhere nobody expected.
	 */
	private async relationship(contactId: string, companyId: string | null) {
		const now = new Date();

		const [threads, lastReply, meetings, nextMeeting, colleagues] =
			await Promise.all([
				this.db.emailThread.aggregate({
					where: { contactId },
					_sum: { messageCount: true },
					_count: { _all: true },
				}),
				this.db.emailMessage.findFirst({
					where: { thread: { contactId }, direction: "INBOUND" },
					orderBy: { sentAt: "desc" },
					select: { sentAt: true },
				}),
				this.db.calendarEvent.count({
					where: {
						OR: [{ contactId }, { attendees: { some: { contactId } } }],
					},
				}),
				this.db.calendarEvent.findFirst({
					where: {
						startsAt: { gt: now },
						OR: [{ contactId }, { attendees: { some: { contactId } } }],
					},
					orderBy: { startsAt: "asc" },
					select: { title: true, startsAt: true },
				}),
				companyId
					? this.db.contact.findMany({
							where: { companyId, id: { not: contactId } },
							orderBy: { lastActivityAt: { sort: "desc", nulls: "last" } },
							take: 4,
							select: {
								id: true,
								firstName: true,
								lastName: true,
								title: true,
							},
						})
					: Promise.resolve([]),
			]);

		return {
			emails: threads._sum.messageCount ?? 0,
			threads: threads._count._all,
			// The distinction that matters on a sheet: we have emailed them 12
			// times and they have never once written back is a different
			// relationship from 12 emails with 6 replies.
			lastReplyAt: lastReply?.sentAt.toISOString() ?? null,
			meetings,
			nextMeeting: nextMeeting
				? {
						title: nextMeeting.title,
						startsAt: nextMeeting.startsAt.toISOString(),
					}
				: null,
			colleagues: colleagues.map((colleague) => ({
				id: colleague.id,
				name: [colleague.firstName, colleague.lastName]
					.filter(Boolean)
					.join(" "),
				title: colleague.title,
			})),
		};
	}

	/**
	 * A rep accepting or dismissing something the agent proposed.
	 *
	 * Accepting writes the value through to the record and supersedes whatever
	 * was there; dismissing keeps the row so the agent can be told never to
	 * offer it again. Neither branch researches anything — this is a human
	 * decision being executed, which is the only enrichment-shaped thing that
	 * belongs on this side of the wire.
	 */
	async decideFact(
		input: FactDecisionInput,
		userId: string,
	): Promise<{ contactId: string; field: string; applied: boolean }> {
		const fact = await this.db.contactFact.findUnique({
			where: { id: input.factId },
			select: {
				id: true,
				contactId: true,
				field: true,
				value: true,
				status: true,
			},
		});

		if (!fact) {
			throw new NotFoundException(`No fact with id ${input.factId}.`);
		}

		if (fact.status !== FactStatus.PROPOSED) {
			throw new ConflictException("That suggestion has already been settled.");
		}

		const accepted = input.decision === "accept";
		const column = FACT_COLUMNS[fact.field];

		await this.db.$transaction(async (tx) => {
			if (accepted) {
				await tx.contactFact.updateMany({
					where: {
						contactId: fact.contactId,
						field: fact.field,
						status: FactStatus.APPLIED,
					},
					data: { status: FactStatus.SUPERSEDED, supersededAt: new Date() },
				});
			}

			await tx.contactFact.update({
				where: { id: fact.id },
				data: {
					status: accepted ? FactStatus.APPLIED : FactStatus.DISMISSED,
					decidedById: userId,
					decidedAt: new Date(),
				},
			});

			if (accepted && column) {
				await tx.contact.update({
					where: { id: fact.contactId },
					data: { [column]: fact.value },
				});
			}

			if (accepted && fact.field === "name") {
				const [firstName, ...rest] = fact.value.trim().split(/\s+/);
				if (firstName) {
					await tx.contact.update({
						where: { id: fact.contactId },
						data: {
							firstName,
							lastName: rest.length > 0 ? rest.join(" ") : null,
						},
					});
				}
			}
		});

		// Accepting title/name is a human decision onto Sage-pushable columns —
		// same enqueue as contacts.update, so reps do not need a second edit.
		if (accepted && (fact.field === "title" || fact.field === "name")) {
			await this.sagePush.enqueueAndKick("contact", fact.contactId, userId);
		}

		this.logger.log({
			message: "Fact decided",
			factId: fact.id,
			contactId: fact.contactId,
			field: fact.field,
			decision: input.decision,
		});

		return { contactId: fact.contactId, field: fact.field, applied: accepted };
	}

	/** `q` matches a name, an email address, or where they work. */
	private searchFilter(q: string): Prisma.ContactWhereInput {
		const term = q.trim();
		if (!term) return {};

		return {
			OR: [
				{ firstName: { contains: term, mode: "insensitive" } },
				{ lastName: { contains: term, mode: "insensitive" } },
				{ email: { contains: term, mode: "insensitive" } },
				{ company: { name: { contains: term, mode: "insensitive" } } },
			],
		};
	}

	private buildWhere(input: ContactListInput): Prisma.ContactWhereInput {
		const where: Prisma.ContactWhereInput = {
			...this.searchFilter(input.q),
			...ownerFilter(input.owner),
		};

		if (input.company !== FACET_ALL) {
			where.companyId = input.company === NO_COMPANY ? null : input.company;
		}

		if (input.source !== FACET_ALL) {
			where.source = input.source as RecordSource;
		}

		return where;
	}

	/** Counts against the search term only — see `CompaniesService.facetCounts`. */
	private async facetCounts(input: ContactListInput) {
		const where = this.searchFilter(input.q);

		const [owners, companies, sources] = await Promise.all([
			this.db.contact.groupBy({
				by: ["ownerId"],
				where,
				_count: { _all: true },
			}),
			this.db.contact.groupBy({
				by: ["companyId"],
				where,
				_count: { _all: true },
			}),
			this.db.contact.groupBy({
				by: ["source"],
				where,
				_count: { _all: true },
			}),
		]);

		return {
			owner: countsByKey(owners, "ownerId", FACET_UNASSIGNED),
			company: countsByKey(companies, "companyId", NO_COMPANY),
			source: countsByKey(sources, "source"),
		};
	}

	private translate(error: unknown, id: string): unknown {
		if (error instanceof PrismaNamespace.PrismaClientKnownRequestError) {
			if (error.code === "P2025") {
				return new NotFoundException(`No contact with id ${id}.`);
			}
			if (error.code === "P2002") {
				return new ConflictException(
					"Another contact already uses that email address.",
				);
			}
		}
		return error;
	}
}
