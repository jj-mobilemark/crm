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
 * Prod (private Railway DB from a laptop — temporary TCP proxy):
 *   railway tcp-proxy create --port 5432 --service Postgres
 *   MM_PROXY_HOST=… MM_PROXY_PORT=… railway run -s api -- \
 *     bun run scripts/run-via-tcp-proxy.ts ./fix-sage-website-notes.ts --dry-run
 *   … then without --dry-run …
 *   railway tcp-proxy delete <id> --service Postgres --yes
 */
import "@crm/env/load";
import { db } from "@crm/db";
import { majorityWorkDomain, normalizeDomain } from "../src/companies/domain";

const dryRun = process.argv.includes("--dry-run");
const CONCURRENCY = 20;

function isPlausibleWebsite(value: string): boolean {
	return normalizeDomain(value) !== null;
}

function isPlausibleDomain(value: string): boolean {
	return normalizeDomain(value) === value.trim().toLowerCase();
}

console.log("loading companies…");
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
const updates: Array<{
	id: string;
	website?: string | null;
	domain?: string | null;
}> = [];

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

	const touchWebsite = clearWebsite || setWebsite !== null;
	const touchDomain = clearDomain || setDomain !== null;
	if (!touchWebsite && !touchDomain) continue;

	if (samples.length < 25) {
		const parts: string[] = [];
		if (clearWebsite)
			parts.push(`website ${JSON.stringify(row.website)}→null`);
		if (clearDomain) parts.push(`domain ${JSON.stringify(row.domain)}→null`);
		if (setDomain) parts.push(`domain→${setDomain}`);
		if (setWebsite) parts.push(`website→${setWebsite}`);
		samples.push(`${row.name}: ${parts.join(", ")}`);
	}

	updates.push({
		id: row.id,
		...(touchWebsite ? { website: nextWebsite } : {}),
		...(touchDomain ? { domain: nextDomain } : {}),
	});
}

console.log(
	JSON.stringify(
		{
			dryRun,
			scanned: rows.length,
			toUpdate: updates.length,
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

if (!dryRun) {
	let done = 0;
	let cursor = 0;
	const workers = Array.from({ length: CONCURRENCY }, async () => {
		while (cursor < updates.length) {
			const index = cursor;
			cursor += 1;
			const row = updates[index];
			if (!row) return;
			await db.company.update({
				where: { id: row.id },
				data: {
					...(row.website !== undefined ? { website: row.website } : {}),
					...(row.domain !== undefined ? { domain: row.domain } : {}),
				},
			});
			done += 1;
			if (done % 100 === 0 || done === updates.length) {
				console.log(`wrote ${done} / ${updates.length}`);
			}
		}
	});
	await Promise.all(workers);
}

await db.$disconnect();
