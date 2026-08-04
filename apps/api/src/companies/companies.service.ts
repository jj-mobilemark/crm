import {
	type Db,
	type EnrichmentStatus,
	type Prisma,
	Prisma as PrismaNamespace,
	type RecordSource,
} from "@crm/db";
import {
	BadRequestException,
	ConflictException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { AgentQueueService } from "../agent/agent-queue.service";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { blankToNull, toCents } from "../crm/values";
import { InjectDatabase } from "../database/database.constants";
import { OPEN_DEAL_STAGES } from "../deals/deal-stage";
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
	CompanyCreateInput,
	CompanyListInput,
	CompanyMapListInput,
	CompanySimilarInput,
	CompanyUpdateInput,
} from "./companies.contracts";
import { MAP_LIST_MAX } from "./companies.contracts";
import { normalizeCompanyName } from "./company-name";
import { normalizeDomain } from "./domain";
import { FaviconService } from "./favicon.service";

/** Signed-in actor for Sage push attribution (human UI only). */
export type CompanyActor = { id: string };

const OWNER_SELECT = {
	id: true,
	name: true,
	email: true,
	image: true,
} as const;

/** One row of the companies table. */
export type CompanyRow = {
	id: string;
	name: string;
	domain: string | null;
	iconUrl: string | null;
	iconDarkUrl: string | null;
	iconTone: string | null;
	logoUrl: string | null;
	brandColor: string | null;
	industry: string | null;
	enrichmentStatus: EnrichmentStatus;
	/**
	 * Whether the agent actually has this company on its list.
	 *
	 * Separate from `enrichmentStatus` because that column defaults to PENDING
	 * and so cannot tell "waiting its turn" from "nobody ever asked".
	 */
	queued: boolean;
	source: RecordSource;
	/** Sage CRM eware company id, when this row was pulled from Sage. */
	sageCrmCompanyId: string | null;
	/** Sage 100 customer number (keep leading zeros). */
	sage100CustomerNo: string | null;
	/** Sage 100 AR division. */
	sage100ArDivisionNo: string | null;
	owner: {
		id: string;
		name: string;
		email: string;
		image: string | null;
	} | null;
	/**
	 * Designated primary, or the most recently created contact when none is set.
	 * Null when the company has no contacts.
	 */
	primaryContact: {
		id: string;
		firstName: string;
		lastName: string | null;
		email: string | null;
	} | null;
	contactCount: number;
	openDealCount: number;
	/** ISO-8601, or null when nothing has happened yet. */
	lastActivityAt: string | null;
	createdAt: string;
};

/**
 * Columns `?sort=` may name, and the Prisma ordering each one means.
 *
 * Spelled out rather than derived from the column id so `?sort=` can never
 * reach Prisma as an arbitrary field name — and because ordering by a relation
 * count is not a flat `{ [id]: dir }`.
 */
const SORTABLE: Record<
	string,
	(dir: Prisma.SortOrder) => Prisma.CompanyOrderByWithRelationInput
> = {
	name: (dir) => ({ name: dir }),
	domain: (dir) => ({ domain: dir }),
	industry: (dir) => ({ industry: dir }),
	createdAt: (dir) => ({ createdAt: dir }),
	contacts: (dir) => ({ contacts: { _count: dir } }),
	deals: (dir) => ({ deals: { _count: dir } }),
	// By the owner's name, not their id — nobody scans a list of cuids.
	// Unassigned rows sort last either way: they are the least interesting.
	owner: (dir) => ({ owner: { name: dir } }),
	// A real column, so this is an index scan. Never-touched rows sort last in
	// both directions, because "no activity" is not "the oldest activity".
	lastActivity: (dir) => ({ lastActivityAt: { sort: dir, nulls: "last" } }),
};

/** One row of the companies map page (list + markers). */
export type CompanyMapRow = {
	id: string;
	name: string;
	domain: string | null;
	city: string | null;
	stateCode: string | null;
	country: string | null;
	latitude: number | null;
	longitude: number | null;
	/** Sage 100 customer number (`mas_customerno`), not Sage CRM id. */
	sage100CustomerNo: string | null;
	owner: {
		id: string;
		name: string;
		email: string;
		image: string | null;
	} | null;
	/** True when the signed-in user owns this company. */
	isMine: boolean;
};

const MAP_SORTABLE: Record<
	CompanyMapListInput["sort"],
	(dir: Prisma.SortOrder) => Prisma.CompanyOrderByWithRelationInput
> = {
	name: (dir) => ({ name: dir }),
	city: (dir) => ({ city: { sort: dir, nulls: "last" } }),
	owner: (dir) => ({ owner: { name: dir } }),
};

@Injectable()
export class CompaniesService {
	private readonly logger = new Logger(CompaniesService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly agent: AgentTriggerService,
		private readonly queue: AgentQueueService,
		private readonly favicon: FaviconService,
		private readonly sagePush: SagePushService,
	) {}

	async list(input: CompanyListInput): Promise<ListResult<CompanyRow>> {
		const where = this.buildWhere(input);
		const { skip, take } = paginate(input);

		const [rows, total, facetCounts] = await Promise.all([
			this.db.company.findMany({
				where,
				skip,
				take,
				orderBy: resolveOrderBy(input, SORTABLE, {
					createdAt: "desc",
				}),
				select: {
					id: true,
					name: true,
					domain: true,
					iconUrl: true,
					iconDarkUrl: true,
					iconTone: true,
					logoUrl: true,
					brandColor: true,
					industry: true,
					enrichmentStatus: true,
					source: true,
					sageCrmCompanyId: true,
					sage100CustomerNo: true,
					sage100ArDivisionNo: true,
					owner: { select: OWNER_SELECT },
					primaryContact: {
						select: {
							id: true,
							firstName: true,
							lastName: true,
							email: true,
						},
					},
					// Fallback when no primary is set: most recently created.
					contacts: {
						take: 1,
						orderBy: { createdAt: "desc" },
						select: {
							id: true,
							firstName: true,
							lastName: true,
							email: true,
						},
					},
					_count: {
						select: {
							contacts: true,
							deals: { where: { stage: { in: [...OPEN_DEAL_STAGES] } } },
						},
					},
					lastActivityAt: true,
					createdAt: true,
				},
			}),
			this.db.company.count({ where }),
			this.facetCounts(input),
		]);

		// After the page is known, so it is one query for the rows on screen
		// rather than a join that would have to be repeated for the facet counts.
		const queued = await this.queue.queuedCompanies(rows.map((row) => row.id));

		return {
			rows: rows.map((row) => ({
				id: row.id,
				name: row.name,
				domain: row.domain,
				iconUrl: row.iconUrl,
				iconDarkUrl: row.iconDarkUrl,
				iconTone: row.iconTone,
				logoUrl: row.logoUrl,
				brandColor: row.brandColor,
				industry: row.industry,
				enrichmentStatus: row.enrichmentStatus,
				queued: queued.has(row.id),
				source: row.source,
				sageCrmCompanyId: row.sageCrmCompanyId,
				sage100CustomerNo: row.sage100CustomerNo,
				sage100ArDivisionNo: row.sage100ArDivisionNo,
				owner: row.owner,
				primaryContact: row.primaryContact ?? row.contacts[0] ?? null,
				contactCount: row._count.contacts,
				openDealCount: row._count.deals,
				lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
				createdAt: row.createdAt.toISOString(),
			})),
			total,
			facetCounts,
		};
	}

	/**
	 * Unpaginated lightweight rows for `/map`. Caps at MAP_LIST_MAX.
	 *
	 * `owner: "me"` resolves against the signed-in user id.
	 */
	async mapList(
		input: CompanyMapListInput,
		userId: string,
	): Promise<{ rows: CompanyMapRow[]; total: number }> {
		const where = this.buildMapWhere(input, userId);
		const total = await this.db.company.count({ where });
		if (total > MAP_LIST_MAX) {
			throw new BadRequestException(
				`Too many companies match (${total}). Narrow the filters (max ${MAP_LIST_MAX}).`,
			);
		}

		const rows = await this.db.company.findMany({
			where,
			orderBy: MAP_SORTABLE[input.sort](input.dir),
			select: {
				id: true,
				name: true,
				domain: true,
				city: true,
				stateCode: true,
				country: true,
				latitude: true,
				longitude: true,
				sage100CustomerNo: true,
				owner: { select: OWNER_SELECT },
			},
		});

		return {
			total,
			rows: rows.map((row) => ({
				id: row.id,
				name: row.name,
				domain: row.domain,
				city: row.city,
				stateCode: row.stateCode,
				country: row.country,
				latitude: row.latitude,
				longitude: row.longitude,
				sage100CustomerNo: row.sage100CustomerNo,
				owner: row.owner,
				isMine: row.owner?.id === userId,
			})),
		};
	}

	async byId(id: string) {
		const company = await this.db.company.findUnique({
			where: { id },
			select: {
				id: true,
				name: true,
				domain: true,
				website: true,
				description: true,
				logoUrl: true,
				logoDarkUrl: true,
				iconUrl: true,
				iconDarkUrl: true,
				iconTone: true,
				brandColor: true,
				industry: true,
				subIndustry: true,
				city: true,
				stateCode: true,
				country: true,
				countryCode: true,
				phone: true,
				email: true,
				linkedinUrl: true,
				twitterUrl: true,
				githubUrl: true,
				pricingUrl: true,
				careersUrl: true,
				enrichmentStatus: true,
				enrichedAt: true,
				enrichmentError: true,
				source: true,
				sageCrmCompanyId: true,
				sage100CustomerNo: true,
				sage100ArDivisionNo: true,
				createdAt: true,
				owner: { select: OWNER_SELECT },
				primaryContact: {
					select: {
						id: true,
						firstName: true,
						lastName: true,
						email: true,
						phone: true,
						title: true,
					},
				},
				contacts: {
					orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
					select: {
						id: true,
						firstName: true,
						lastName: true,
						email: true,
						title: true,
						owner: { select: OWNER_SELECT },
					},
				},
				deals: {
					orderBy: [{ stage: "asc" }, { expectedCloseDate: "asc" }],
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
		});

		if (!company) {
			throw new NotFoundException(`No company with id ${id}.`);
		}

		const { deals, primaryContact, enrichedAt, createdAt, ...rest } = company;

		return {
			...rest,
			queued: await this.queue.isQueued({ companyId: id }),
			createdAt: createdAt.toISOString(),
			enrichedAt: enrichedAt?.toISOString() ?? null,
			primaryContactId: primaryContact?.id ?? null,
			primaryContact,
			deals: deals.map((deal) => ({
				...deal,
				amount: undefined,
				amountCents: toCents(deal.amount),
				expectedCloseDate: deal.expectedCloseDate?.toISOString() ?? null,
			})),
		};
	}

	/**
	 * Companies for a picker or a facet label — id, name and enough to draw the
	 * logo, nothing else.
	 *
	 * Capped at 100 and searchable, so the "which company?" dropdown on a contact
	 * or a deal stays a dropdown rather than becoming a second list view.
	 */
	async options(q: string) {
		return this.db.company.findMany({
			where: this.searchFilter(q),
			select: { id: true, name: true, domain: true, iconUrl: true },
			orderBy: { name: "asc" },
			take: 100,
		});
	}

	/**
	 * Possible duplicates for the create form. Domain match is hard (create
	 * would fail); name match is soft and needs a human confirm.
	 */
	async similar(input: CompanySimilarInput) {
		const name = input.name.trim();
		const domain = normalizeDomain(input.domain);
		const normalized = normalizeCompanyName(name);

		if (!name) return { matches: [] };

		const tokens = normalized
			.split(" ")
			.filter((token) => token.length >= 3)
			.toSorted((a, b) => b.length - a.length)
			.slice(0, 3);

		const terms = [...new Set([name, ...tokens])];
		const or: Prisma.CompanyWhereInput[] = [];
		if (domain) or.push({ domain });
		for (const term of terms) {
			or.push({ name: { contains: term, mode: "insensitive" } });
		}

		const rows = await this.db.company.findMany({
			where: { OR: or },
			select: {
				id: true,
				name: true,
				domain: true,
				city: true,
				stateCode: true,
				iconUrl: true,
				sageCrmCompanyId: true,
				sage100CustomerNo: true,
			},
			take: 40,
		});

		const ranked = rows
			.map((row) => rankSimilar(row, { domain, normalized }))
			.filter((row): row is NonNullable<typeof row> => row !== null)
			.toSorted((a, b) => b.score - a.score || a.name.localeCompare(b.name))
			.slice(0, 8);

		return {
			matches: ranked.map(({ score: _score, ...match }) => match),
		};
	}

	async create(input: CompanyCreateInput, actor?: CompanyActor) {
		const domain = normalizeDomain(input.domain);

		if (domain) {
			const existing = await this.db.company.findUnique({
				where: { domain },
				select: { id: true, name: true },
			});
			if (existing) {
				throw new ConflictException(
					`${existing.name} already uses the domain ${domain}.`,
				);
			}
		}

		const company = await this.db.company.create({
			data: {
				name: input.name.trim(),
				domain,
				website: domain ? `https://${domain}` : null,
				ownerId: input.ownerId ?? null,
			},
			select: { id: true, name: true, domain: true },
		});

		this.logger.log({
			message: "Company created",
			companyId: company.id,
			domain: company.domain,
		});

		// Fire-and-forget: the create form should not wait on research, and the
		// detail page polls until it settles. All this says is that a company now
		// exists with nothing on it but a domain — what to do about that is the
		// agent's call.
		await this.agent.companyCreated(company.id);

		// Not awaited, for the same reason: the icon is worth a second or two of
		// somebody else's origin being slow, and the form is not. The list polls
		// while the row is enriching, so it lands without a reload.
		void this.favicon.backfill(company.id, company.domain);

		// Human UI create -> SageOutbox (sync/agent paths never call this method).
		if (actor) {
			await this.sagePush.enqueueAndKick("company", company.id, actor.id);
		}

		return company;
	}

	async update(id: string, input: CompanyUpdateInput, actor?: CompanyActor) {
		const data: Prisma.CompanyUpdateInput = {};

		if (input.name !== undefined) data.name = input.name.trim();
		if (input.website !== undefined) data.website = blankToNull(input.website);
		if (input.description !== undefined) {
			data.description = blankToNull(input.description);
		}
		if (input.industry !== undefined)
			data.industry = blankToNull(input.industry);
		if (input.city !== undefined) data.city = blankToNull(input.city);
		if (input.stateCode !== undefined) {
			data.stateCode = blankToNull(input.stateCode);
		}
		if (input.country !== undefined) data.country = blankToNull(input.country);
		if (
			input.city !== undefined ||
			input.stateCode !== undefined ||
			input.country !== undefined
		) {
			data.latitude = null;
			data.longitude = null;
			data.geocodePlaceKey = null;
			data.geocodedAt = null;
		}
		if (input.phone !== undefined) data.phone = blankToNull(input.phone);
		if (input.email !== undefined) data.email = blankToNull(input.email);
		if (input.linkedinUrl !== undefined) {
			data.linkedinUrl = blankToNull(input.linkedinUrl);
		}
		if (input.ownerId !== undefined) {
			data.owner = input.ownerId
				? { connect: { id: input.ownerId } }
				: { disconnect: true };
		}

		if (input.domain !== undefined) {
			const domain = normalizeDomain(input.domain);
			if (input.domain.trim() && !domain) {
				throw new BadRequestException(
					`"${input.domain}" is not a domain — try something like "stripe.com".`,
				);
			}
			data.domain = domain;
			// A new domain means the enrichment we have is for the wrong company.
			// Phase 6 picks PENDING rows up; until then this is honest bookkeeping.
			const current = await this.db.company.findUnique({
				where: { id },
				select: { domain: true },
			});
			if (current && current.domain !== domain) {
				data.enrichmentStatus = "PENDING";
				data.enrichmentError = null;
				// The icon is one of the things that was about a different company,
				// and it is the one a rep can see. Cleared so the row shows a
				// placeholder until the new domain answers, rather than confidently
				// showing the old company's mark.
				//
				// All three variants, not just `iconUrl`: the agent's `brandToUpdate`
				// only fills fields that are null, so a stale `iconDarkUrl` would
				// survive re-enrichment and keep showing the previous company's mark
				// to anyone in dark mode.
				data.iconUrl = null;
				data.iconDarkUrl = null;
				data.iconTone = null;
			}
		}

		try {
			const updated = await this.db.company.update({
				where: { id },
				data,
				select: { id: true, name: true, domain: true },
			});

			if (data.enrichmentStatus === "PENDING") {
				await this.agent.companyCreated(
					id,
					"Domain changed — anything we knew was about a different company",
				);
				void this.favicon.backfill(id, updated.domain);
			}

			// Human UI update of mapped fields -> SageOutbox.
			if (
				actor &&
				(input.name !== undefined ||
					input.website !== undefined ||
					input.domain !== undefined)
			) {
				await this.sagePush.enqueueAndKick("company", id, actor.id);
			}

			return updated;
		} catch (error) {
			throw this.translate(error, id);
		}
	}

	/**
	 * The "Look this up again" button.
	 *
	 * Queues the work at the front and returns immediately. It no longer forces
	 * a vendor cache bypass, because the API no longer knows there is a vendor:
	 * a rep asking for a fresh look is an event, and how to honour it — which
	 * sources, how deep, whether the cached answer is still good — belongs to
	 * the agent.
	 */
	async enrich(id: string): Promise<{ id: string; queued: boolean }> {
		const company = await this.db.company.findUnique({
			where: { id },
			select: { id: true },
		});

		if (!company) {
			throw new NotFoundException(`No company with id ${id}.`);
		}

		await this.db.company.update({
			where: { id },
			data: { enrichmentStatus: "PENDING", enrichmentError: null },
		});
		await this.agent.companyRequested(id, "A rep asked for a fresh look");

		return { id, queued: true };
	}

	/** Asks the agent for a written brief on the company's timeline. */
	async research(id: string, actingUserId: string) {
		const company = await this.db.company.findUnique({
			where: { id },
			select: { id: true, domain: true },
		});

		if (!company) {
			throw new NotFoundException(`No company with id ${id}.`);
		}

		if (!company.domain) {
			throw new BadRequestException(
				"There is nothing to read without a domain — add one first.",
			);
		}

		await this.agent.companyRequested(
			id,
			`Briefing requested by a rep (${actingUserId})`,
		);

		return { ok: true as const, queued: true as const };
	}

	/**
	 * Points a company at the person to call.
	 *
	 * The contact has to already belong to the company: a "primary contact" who
	 * works somewhere else is a data-entry accident, not a relationship.
	 */
	async setPrimaryContact(companyId: string, contactId: string | null) {
		if (contactId) {
			const contact = await this.db.contact.findUnique({
				where: { id: contactId },
				select: { companyId: true },
			});
			if (!contact) {
				throw new NotFoundException(`No contact with id ${contactId}.`);
			}
			if (contact.companyId !== companyId) {
				throw new BadRequestException(
					"That contact does not work at this company.",
				);
			}
		}

		try {
			return await this.db.company.update({
				where: { id: companyId },
				data: { primaryContactId: contactId },
				select: { id: true, primaryContactId: true },
			});
		} catch (error) {
			throw this.translate(error, companyId);
		}
	}

	/** `q` matches the name or the domain — the two things a rep would type. */
	private searchFilter(q: string): Prisma.CompanyWhereInput {
		const term = q.trim();
		if (!term) return {};

		return {
			OR: [
				{ name: { contains: term, mode: "insensitive" } },
				{ domain: { contains: term, mode: "insensitive" } },
			],
		};
	}

	private buildWhere(input: CompanyListInput): Prisma.CompanyWhereInput {
		const where: Prisma.CompanyWhereInput = {
			...this.searchFilter(input.q),
			...ownerFilter(input.owner),
		};

		if (input.industry !== FACET_ALL) {
			where.industry = input.industry;
		}

		if (input.enrichment !== FACET_ALL) {
			where.enrichmentStatus = input.enrichment as EnrichmentStatus;
		}

		if (input.source !== FACET_ALL) {
			where.source = input.source as RecordSource;
		}

		return where;
	}

	private buildMapWhere(
		input: CompanyMapListInput,
		userId: string,
	): Prisma.CompanyWhereInput {
		const owner =
			input.owner === "me" ? userId : input.owner;
		const where: Prisma.CompanyWhereInput = {
			...this.searchFilter(input.q),
			...ownerFilter(owner),
		};

		if (input.sage === "linked") {
			// Sage 100 customer # (ERP), not Sage CRM companyid — most CRM
			// companies have a CRM id; only ~1/3 have a Sage 100 link.
			where.AND = [
				...(Array.isArray(where.AND)
					? where.AND
					: where.AND
						? [where.AND]
						: []),
				{ sage100CustomerNo: { not: null } },
				{ NOT: { sage100CustomerNo: "" } },
			];
		} else if (input.sage === "unlinked") {
			where.AND = [
				...(Array.isArray(where.AND)
					? where.AND
					: where.AND
						? [where.AND]
						: []),
				{
					OR: [{ sage100CustomerNo: null }, { sage100CustomerNo: "" }],
				},
			];
		}

		if (input.hasLocation === "yes") {
			where.latitude = { not: null };
			where.longitude = { not: null };
		} else if (input.hasLocation === "no") {
			// Avoid clobbering searchFilter's OR — nest under AND instead.
			where.AND = [
				...(Array.isArray(where.AND)
					? where.AND
					: where.AND
						? [where.AND]
						: []),
				{ OR: [{ latitude: null }, { longitude: null }] },
			];
		}

		return where;
	}

	/**
	 * Counts for the facet dropdowns.
	 *
	 * Computed against the search term only, not the other facets: counts that
	 * shift every time you touch a different dropdown are hard to read, and
	 * options that vanish are worse.
	 */
	private async facetCounts(input: CompanyListInput) {
		const where = this.searchFilter(input.q);

		const [owners, industries, enrichment, sources] = await Promise.all([
			this.db.company.groupBy({
				by: ["ownerId"],
				where,
				_count: { _all: true },
			}),
			this.db.company.groupBy({
				by: ["industry"],
				where,
				_count: { _all: true },
			}),
			this.db.company.groupBy({
				by: ["enrichmentStatus"],
				where,
				_count: { _all: true },
			}),
			this.db.company.groupBy({
				by: ["source"],
				where,
				_count: { _all: true },
			}),
		]);

		return {
			owner: countsByKey(owners, "ownerId", FACET_UNASSIGNED),
			industry: countsByKey(industries, "industry"),
			enrichment: countsByKey(enrichment, "enrichmentStatus"),
			source: countsByKey(sources, "source"),
		};
	}

	/** Prisma's constraint errors, said in a way a rep can act on. */
	private translate(error: unknown, id: string): unknown {
		if (error instanceof PrismaNamespace.PrismaClientKnownRequestError) {
			if (error.code === "P2025") {
				return new NotFoundException(`No company with id ${id}.`);
			}
			if (error.code === "P2002") {
				return new ConflictException(
					"Another company already uses that domain.",
				);
			}
		}
		return error;
	}
}

type SimilarCandidate = {
	id: string;
	name: string;
	domain: string | null;
	city: string | null;
	stateCode: string | null;
	iconUrl: string | null;
	sageCrmCompanyId: string | null;
	sage100CustomerNo: string | null;
};

/**
 * Score a candidate against the typed name/domain. Returns null when the hit
 * is too weak to bother a human with.
 */
function rankSimilar(
	row: SimilarCandidate,
	input: { domain: string | null; normalized: string },
): (SimilarCandidate & {
	score: number;
	reason: "domain" | "name";
	blocksCreate: boolean;
}) | null {
	if (input.domain && row.domain === input.domain) {
		return {
			...row,
			score: 100,
			reason: "domain",
			blocksCreate: true,
		};
	}

	const candidate = normalizeCompanyName(row.name);
	if (!input.normalized || !candidate) return null;

	if (candidate === input.normalized) {
		return {
			...row,
			score: 90,
			reason: "name",
			blocksCreate: false,
		};
	}

	// One normalised name contains the other — "Acme" vs "Acme Widgets".
	const shorter =
		candidate.length <= input.normalized.length ? candidate : input.normalized;
	const longer =
		candidate.length > input.normalized.length ? candidate : input.normalized;
	if (shorter.length >= 3 && longer.includes(shorter)) {
		return {
			...row,
			score: 70,
			reason: "name",
			blocksCreate: false,
		};
	}

	const inputTokens = new Set(
		input.normalized.split(" ").filter((token) => token.length >= 3),
	);
	const rowTokens = candidate.split(" ").filter((token) => token.length >= 3);
	if (inputTokens.size === 0 || rowTokens.length === 0) return null;

	const overlap = rowTokens.filter((token) => inputTokens.has(token)).length;
	const needed = Math.ceil(inputTokens.size * 0.6);
	if (overlap >= needed && overlap >= 1) {
		return {
			...row,
			score: 50 + overlap * 5,
			reason: "name",
			blocksCreate: false,
		};
	}

	return null;
}
