import { db, EnrichmentStatus } from "@crm/db";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { brandToUpdate, filledFields } from "../lib/brand-mapping";
import { brandByDomain, contextDevEnabled } from "../lib/context-dev";
import { spend } from "../lib/focus";

/**
 * A company's brand, firmographics and socials, from Context.dev.
 *
 * This used to be a Nest service on the API side, queued from a request
 * handler. Nothing about the lookup changed in the move; what changed is who
 * decides to make it. The API now says "a company exists with nothing but a
 * domain" and this decides whether that is worth ten credits.
 *
 * Fills gaps only. `brandToUpdate` has always refused to overwrite a field a
 * human filled in, and that rule is the same one the fact store applies to
 * people.
 */
export default defineTool({
	description:
		"Look up a company's brand, industry, location and social links by domain, and fill in the blanks on its record. Fills empty fields only — never overwrites what a person typed.",
	inputSchema: z.object({
		companyId: z.string(),
		fresh: z
			.boolean()
			.default(false)
			.describe(
				"Bypass the vendor's ~90-day cache. Only when a rep has asked for a fresh look.",
			),
	}),
	async execute({ companyId, fresh }) {
		if (!contextDevEnabled()) {
			return {
				enriched: false as const,
				reason: "Context.dev is not configured.",
			};
		}

		const company = await db.company.findUnique({
			where: { id: companyId },
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
			},
		});

		if (!company)
			return { enriched: false as const, reason: "No such company." };

		const lookupDomain =
			company.domain ??
			domainFromWebsite(company.website);

		if (!lookupDomain) {
			await settle(
				companyId,
				EnrichmentStatus.SKIPPED,
				"No domain to look up.",
			);
			return { enriched: false as const, reason: "No domain on this company." };
		}

		const charge = spend(2);
		if (!charge.ok) return { enriched: false as const, reason: charge.reason };

		await db.company.update({
			where: { id: companyId },
			data: {
				enrichmentStatus: EnrichmentStatus.RUNNING,
				enrichmentError: null,
			},
		});

		// `fresh` asks for a cache bypass; anything else takes whatever the vendor
		// has, because a 90-day-old logo is still the logo.
		const result = await brandByDomain(lookupDomain, fresh ? 0 : undefined);

		if (result.outcome === "skipped") {
			await settle(companyId, EnrichmentStatus.SKIPPED, result.reason);
			return { enriched: false as const, reason: result.reason };
		}

		if (result.outcome === "failed") {
			await settle(companyId, EnrichmentStatus.FAILED, result.reason);
			return {
				enriched: false as const,
				reason: result.reason,
				retryable: result.retryable,
			};
		}

		const update = brandToUpdate(result.brand, {
			...company,
			// A company the sync created is named after its domain until we know
			// better, and that is the one non-null field a lookup may replace.
			nameIsPlaceholder:
				company.name === company.domain || company.name === lookupDomain,
		});
		const filled = filledFields(update);

		await db.$transaction([
			db.company.update({ where: { id: companyId }, data: update }),
			db.companyEnrichment.upsert({
				where: { companyId },
				create: { companyId, raw: result.raw as object },
				update: { raw: result.raw as object, fetchedAt: new Date() },
			}),
			db.company.update({
				where: { id: companyId },
				data: {
					enrichmentStatus: EnrichmentStatus.COMPLETE,
					enrichedAt: new Date(),
					enrichmentError: null,
				},
			}),
		]);

		return {
			enriched: true as const,
			filled,
			note:
				filled.length === 0
					? "Everything it returned was already on the record."
					: undefined,
		};
	},
});

async function settle(
	companyId: string,
	status: EnrichmentStatus,
	error: string,
): Promise<void> {
	await db.company.update({
		where: { id: companyId },
		data: { enrichmentStatus: status, enrichmentError: error },
	});
}

/** Bare host from a stored website URL, or null when it is not URL-shaped. */
function domainFromWebsite(website: string | null): string | null {
	const trimmed = website?.trim();
	if (!trimmed || /\s/.test(trimmed)) return null;
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
		? trimmed
		: `https://${trimmed}`;
	try {
		const host = new URL(withScheme).hostname
			.replace(/^www\./i, "")
			.toLowerCase();
		return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
	} catch {
		return null;
	}
}
