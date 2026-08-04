import { type Db, EnrichmentStatus } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { InjectDatabase } from "../database/database.constants";
import { companyNameGuessFromDomain } from "./company-name-guess";
import {
	findSimilarCompanies,
	pickStrongUniqueMatch,
} from "./company-similar";
import { domainFromEmail } from "./domain";

/**
 * "Which company does this address belong to?" — the CRM half of a question
 * that used to be half enrichment.
 *
 * Exact domain first; then a strong unique soft-match (name/related host) so
 * Screening and sync do not invent `hitachirail-cd.com`-style orphans when
 * "Hitachi Rail" already exists. Weak/ambiguous cases still create by domain.
 */
@Injectable()
export class CompanyDirectoryService {
	private readonly logger = new Logger(CompanyDirectoryService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly agent: AgentTriggerService,
	) {}

	async companyForEmail(
		email: string,
		options: {
			ownerId?: string | null;
			/** When false, skip soft-match and always create by domain if no exact hit. */
			softMatch?: boolean;
		} = {},
	): Promise<string | null> {
		const domain = domainFromEmail(email);
		if (!domain) return null;

		const existing = await this.db.company.findUnique({
			where: { domain },
			select: { id: true },
		});
		if (existing) return existing.id;

		const allowSoft = options.softMatch !== false;
		if (allowSoft) {
			const guess = companyNameGuessFromDomain(domain);
			if (guess) {
				const ranked = await findSimilarCompanies(this.db, {
					name: guess,
					domain,
				});
				const strong = pickStrongUniqueMatch(ranked);
				if (strong) {
					this.logger.log({
						message: "Company soft-matched from email domain",
						companyId: strong.id,
						domain,
						score: strong.score,
						reason: strong.reason,
					});
					return strong.id;
				}
			}
		}

		// Two contacts at a new company can race here; the unique index on
		// `domain` is what actually settles it.
		const company = await this.db.company.upsert({
			where: { domain },
			create: {
				name: domain,
				domain,
				website: `https://${domain}`,
				enrichmentStatus: EnrichmentStatus.PENDING,
				// An unowned company is nobody's job. Whoever's action produced it
				// owns it until someone reassigns.
				ownerId: options.ownerId ?? null,
			},
			update: {},
			select: { id: true },
		});

		await this.agent.companyCreated(
			company.id,
			`Created from an email domain (${domain}) — it has no name but the domain`,
		);

		this.logger.log({
			message: "Company created from an email domain",
			companyId: company.id,
			domain,
		});

		return company.id;
	}
}
