/**
 * Repair Sage-imported Company.website / domain values.
 *
 * In this Sage tenant, `comp_website` is often a free-text credit/account note
 * ("FORMERLY …", "NET 30 …", "DO NOT SELL …"), not a website. The pull mapped
 * those notes into local `website` (and sometimes junk into `domain`).
 *
 * This is a **data repair script**, not a Prisma schema migration — run it
 * against each database (local, then prod). Mapping is already fixed in
 * `sage.mappings.ts` so nightly pull will not re-pollute.
 *
 * Steps:
 *   1. Clear non-URL websites and junk domains.
 *   2. Backfill domain (when free) and/or website from contact work emails.
 *
 * Does NOT write back to Sage (push never sends website).
 *
 *   bun run scripts/fix-sage-website-notes.ts --dry-run
 *   bun run scripts/fix-sage-website-notes.ts
 *
 * Prod (Railway Postgres):
 *   DATABASE_URL='postgresql://…' bun run scripts/fix-sage-website-notes.ts --dry-run
 *   DATABASE_URL='postgresql://…' bun run scripts/fix-sage-website-notes.ts
 *
 * Or from Railway: `railway run -s api -- bun run scripts/fix-sage-website-notes.ts`
 * (from `apps/api`, with the project linked).
 */
import "@crm/env/load";
import { db } from "@crm/db";
import { majorityWorkDomain, normalizeDomain } from "../src/companies/domain";

const dryRun = process.argv.includes("--dry-run");

function isPlausibleWebsite(value: string): boolean {
	return normalizeDomain(value) !== null;
}

function isPlausibleDomain(value: string): boolean {
	return normalizeDomain(value) === value.trim().toLowerCase();
}

const rows = await db.company.findMany({
	where: {
		OR: [
			{ website: { not: null } },
			{ domain: { not: null } },
			{ contacts: { some: { email: { not: null } } } },
		],
	},
	select: {
		id: true,
		name: true,
		website: true,
		domain: true,
		contacts: { select: { email: true }, take: 200 },
	},
});

const takenDomains = new Set(
	(
		await db.company.findMany({
			where: { domain: { not: null } },
			select: { domain: true },
		})
	)
		.map((r) => r.domain)
		.filter((d): d is string => d !== null),
);

let clearedWebsite = 0;
let clearedDomain = 0;
let filledDomain = 0;
let filledWebsite = 0;
const samples: string[] = [];

for (const row of rows) {
	const clearWebsite =
		row.website !== null && !isPlausibleWebsite(row.website);
	const clearDomain = row.domain !== null && !isPlausibleDomain(row.domain);

	let nextWebsite = clearWebsite ? null : row.website;
	let nextDomain = clearDomain ? null : row.domain;

	if (clearWebsite) clearedWebsite += 1;
	if (clearDomain) {
		clearedDomain += 1;
		if (row.domain) takenDomains.delete(row.domain);
	}

	const inferred = majorityWorkDomain(row.contacts.map((c) => c.email));
	let setDomain: string | null = null;
	let setWebsite: string | null = null;

	if (inferred) {
		const domainFree =
			!takenDomains.has(inferred) || nextDomain === inferred;
		if (!nextDomain && domainFree) {
			setDomain = inferred;
			nextDomain = inferred;
			takenDomains.add(inferred);
			filledDomain += 1;
		}
		if (!nextWebsite) {
			setWebsite = `https://${inferred}`;
			nextWebsite = setWebsite;
			filledWebsite += 1;
		}
	}

	const changed =
		clearWebsite ||
		clearDomain ||
		setDomain !== null ||
		setWebsite !== null;
	if (!changed) continue;

	if (samples.length < 25) {
		const parts: string[] = [];
		if (clearWebsite) parts.push(`website ${JSON.stringify(row.website)}→null`);
		if (clearDomain) parts.push(`domain ${JSON.stringify(row.domain)}→null`);
		if (setDomain) parts.push(`domain→${setDomain}`);
		if (setWebsite) parts.push(`website→${setWebsite}`);
		samples.push(`${row.name}: ${parts.join(", ")}`);
	}

	if (!dryRun) {
		await db.company.update({
			where: { id: row.id },
			data: {
				...(clearWebsite || setWebsite !== null
					? { website: nextWebsite }
					: {}),
				...(clearDomain || setDomain !== null ? { domain: nextDomain } : {}),
			},
		});
	}
}

console.log(
	JSON.stringify(
		{
			dryRun,
			scanned: rows.length,
			clearedWebsite,
			clearedDomain,
			filledDomain,
			filledWebsite,
			samples,
		},
		null,
		2,
	),
);

await db.$disconnect();
