import { workspaceDomains } from "@crm/auth/workspace";
import { type Db, RecordSource } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { CompanyDirectoryService } from "../companies/company-directory.service";
import { EnrichmentLogService } from "../crm/enrichment-log.service";
import { InjectDatabase } from "../database/database.constants";
// Participants logic is provider-agnostic — shared with Google, never copied.
import {
	dominantDomain,
	externalParticipants,
	isDerivedName,
	type Participant,
	splitName,
	workDomain,
} from "../google/participants";

/**
 * The two sources that can create records.
 *
 * `RecordSource` is generated as a const object rather than a TS enum, so its
 * members are values and this union is how you narrow to them in type position.
 */
export type SyncRecordSource =
	| typeof RecordSource.EMAIL
	| typeof RecordSource.CALENDAR;

/** What a thread or an event resolved to. */
export type MatchResult = {
	companyId: string | null;
	contactId: string | null;
	/** The external participants that survived filtering, for the caller's log. */
	external: Participant[];
};

/** Loaded once per sync pass and threaded through every item in it. */
export type MatchContext = {
	ourAddresses: ReadonlySet<string>;
	ourDomains: ReadonlySet<string>;
	suppressedDomains: ReadonlySet<string>;
};

export type MatchRequest = {
	participants: readonly Participant[];
	/**
	 * Whether this item is allowed to create records it cannot find.
	 *
	 * The caller decides, because the rule is per-source and per-item: a meeting
	 * qualifies on its own, an email thread only once the rep has replied.
	 */
	allowCreate: boolean;
	source: SyncRecordSource;
	/**
	 * Who ends up owning anything created.
	 *
	 * The rep whose mailbox produced the thread or the meeting — they are, by
	 * definition, the person with the relationship. Leaving it unassigned makes
	 * every auto-created record somebody else's problem, which is how a CRM ends
	 * up with a pile of ownerless rows nobody works.
	 */
	ownerId: string;
};

/**
 * Turns the people on a Graph payload into a company and a contact.
 *
 * A near-verbatim twin of `GoogleMatchService`: the rule has to be identical
 * across providers, or the same customer would land on two different company
 * records depending on whether Outlook or Gmail saw them first.
 */
@Injectable()
export class MicrosoftMatchService {
	private readonly logger = new Logger(MicrosoftMatchService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly companies: CompanyDirectoryService,
		private readonly agent: AgentTriggerService,
		private readonly log: EnrichmentLogService,
	) {}

	/**
	 * Who counts as "us".
	 *
	 * Derived from the `User` table rather than configured, and seeded with the
	 * workspace domains so it holds on an empty database and for colleagues who
	 * have never signed in. `workDomain` drops free hosts, so a stray personal
	 * address cannot poison the set. Loaded once per sync pass, not per item.
	 */
	async internalIdentity(): Promise<{
		addresses: Set<string>;
		domains: Set<string>;
	}> {
		const users = await this.db.user.findMany({ select: { email: true } });

		const addresses = new Set<string>();
		const domains = new Set<string>(workspaceDomains());

		for (const user of users) {
			const email = user.email.toLowerCase();
			addresses.add(email);

			const domain = workDomain(email);
			if (domain) domains.add(domain);
		}

		return { addresses, domains };
	}

	async suppressedDomains(): Promise<Set<string>> {
		const rows = await this.db.suppressedDomain.findMany({
			select: { domain: true },
		});
		return new Set(rows.map((row) => row.domain));
	}

	/**
	 * Resolves participants to a company and contact, creating them when the
	 * caller allows it and the guardrails pass.
	 *
	 * Returns `{ companyId: null, contactId: null }` when nothing matched and
	 * nothing was created — the caller's cue to drop the item entirely rather
	 * than store an unattached thread. Personal mail is never written.
	 */
	async resolve(
		request: MatchRequest,
		context: MatchContext,
	): Promise<MatchResult> {
		const external = externalParticipants(request.participants, {
			ourDomains: context.ourDomains,
			ourAddresses: context.ourAddresses,
			suppressedDomains: context.suppressedDomains,
		});

		if (external.length === 0) {
			return { companyId: null, contactId: null, external };
		}

		// An exact contact match is the strongest signal there is — `Contact.email`
		// is unique, so this is the same person, not merely the same employer.
		const contact = await this.db.contact.findFirst({
			where: { email: { in: external.map((person) => person.email) } },
			select: { id: true, companyId: true },
		});

		if (contact) {
			return {
				companyId: contact.companyId,
				contactId: contact.id,
				external,
			};
		}

		const domains = [
			...new Set(
				external
					.map((person) => workDomain(person.email))
					.filter((domain): domain is string => domain !== null),
			),
		];

		const known = await this.db.company.findMany({
			where: { domain: { in: domains } },
			select: { id: true, domain: true },
		});

		const knownDomains = new Set(
			known
				.map((company) => company.domain)
				.filter((domain): domain is string => domain !== null),
		);

		const domain = dominantDomain(external, knownDomains);
		if (!domain) return { companyId: null, contactId: null, external };

		const existing = known.find((company) => company.domain === domain);
		if (existing) {
			return {
				companyId: existing.id,
				// Known company, unknown person. Creating the contact is safe here
				// even without `allowCreate`: we already sell to them, and a thread
				// attributed to the company with no name against it is worse.
				contactId: request.allowCreate
					? await this.createContact(external, domain, existing.id, request)
					: null,
				external,
			};
		}

		if (!request.allowCreate) {
			return { companyId: null, contactId: null, external };
		}

		return this.create(external, domain, request);
	}

	/**
	 * Creates the company and the contact behind a domain we have never seen.
	 *
	 * The company comes from `CompanyDirectoryService.companyForEmail`, which
	 * normalises the domain, upserts against the unique index and tells the
	 * agent a bare company exists — so an auto-created company arrives with a
	 * logo and an industry a few seconds later, exactly like one typed by a rep.
	 */
	private async create(
		external: Participant[],
		domain: string,
		request: MatchRequest,
	): Promise<MatchResult> {
		const lead =
			external.find((person) => workDomain(person.email) === domain) ??
			external[0];

		if (!lead) return { companyId: null, contactId: null, external };

		const companyId = await this.companies.companyForEmail(lead.email, {
			ownerId: request.ownerId,
		});
		if (!companyId) {
			// Not a work domain, so there is nothing to file this against. Not an
			// error, and not a reason to invent a company row.
			return { companyId: null, contactId: null, external };
		}

		await this.db.company.update({
			where: { id: companyId },
			data: { source: request.source },
		});

		const contactId = await this.createContact(
			external,
			domain,
			companyId,
			request,
		);

		await this.log.record({
			companyId,
			subject: "Company added from your inbox",
			body:
				`Created because you ${request.source === "CALENDAR" ? "met" : "emailed"} ` +
				`someone at ${domain}.`,
			meta: { source: request.source, domain },
		});

		this.logger.log({
			message: "Company auto-created from Microsoft sync",
			companyId,
			domain,
			source: request.source,
		});

		return { companyId, contactId, external };
	}

	/** Upserts the person on the domain, so a re-sync does not duplicate them. */
	private async createContact(
		external: Participant[],
		domain: string,
		companyId: string,
		request: MatchRequest,
	): Promise<string | null> {
		const person = external.find(
			(candidate) => workDomain(candidate.email) === domain,
		);
		if (!person) return null;

		const { firstName, lastName } = splitName(person.name, person.email);

		// `Contact.email` is unique, so this is the race-safe form: two reps'
		// syncs hitting the same new person resolve to one row.
		const existing = await this.db.contact.findUnique({
			where: { email: person.email },
			select: { id: true },
		});

		const contact = await this.db.contact.upsert({
			where: { email: person.email },
			create: {
				firstName,
				lastName,
				email: person.email,
				companyId,
				source: request.source,
				ownerId: request.ownerId,
			},
			// Never overwrite a human's edits with a header's display name.
			update: {},
			select: { id: true, firstName: true, lastName: true },
		});

		if (!existing) {
			await this.log.record({
				contactId: contact.id,
				companyId,
				subject: "Contact added from your inbox",
				body: `${person.email} appeared in a ${request.source === "CALENDAR" ? "meeting" : "thread"}.`,
				meta: { source: request.source },
			});
		}

		// Graph hands back a recipient with no display name often enough that a
		// contact is routinely created from the address alone and then met again
		// later with a real name attached. Taking the better name when it arrives
		// is the difference between "Pmarchetti" and "Paula Marchetti" — but only
		// over a name nobody has improved on.
		const hasRealName = Boolean(person.name?.trim());
		const isPlaceholder = isDerivedName(
			person.email,
			contact.firstName,
			contact.lastName,
		);

		if (hasRealName && isPlaceholder) {
			await this.db.contact.update({
				where: { id: contact.id },
				data: { firstName, lastName },
			});
			return contact.id;
		}

		// Still only known by their address. Tell the agent; whether that is worth
		// a lookup, and how deep a one, is its call — this side no longer knows
		// what a sourced identity match costs or how it works.
		if (isPlaceholder && !hasRealName) {
			await this.agent.contactCreated(
				contact.id,
				"Created by the sync from an address, with no name on it",
			);
		}

		return contact.id;
	}
}
