/**
 * Clear Sage-imported Company.email values that are not real emails.
 *
 * In this tenant, nested `email.emailaddress` is often a free-text note
 * ("CORRECT BILLING ADDRESS 4/15/08", "see file for routing…"). Mapping now
 * rejects those on pull; this repairs rows already written.
 *
 * Does NOT write back to Sage. Contact emails are left alone (separate
 * unique constraint / person records).
 *
 *   bun run scripts/fix-sage-company-email-notes.ts --dry-run
 *   bun run scripts/fix-sage-company-email-notes.ts
 */
import "@crm/env/load";
import { db } from "@crm/db";
import { normaliseEmail } from "../src/sage/sage.mappings";

const DRY_RUN = process.argv.includes("--dry-run");
const CHUNK = 200;

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

async function main(): Promise<void> {
	const rows = await db.company.findMany({
		where: { email: { not: null } },
		select: { id: true, name: true, email: true },
	});

	const junk = rows.filter((r) => normaliseEmail(r.email) === null);
	console.log(
		`Companies with email: ${rows.length}; junk (not email-shaped): ${junk.length}`,
	);
	for (const row of junk.slice(0, 10)) {
		console.log(`  sample: ${row.name} → ${JSON.stringify(row.email)}`);
	}

	if (DRY_RUN) {
		console.log("Dry run — no writes.");
		await db.$disconnect();
		return;
	}

	let cleared = 0;
	for (const batch of chunk(
		junk.map((r) => r.id),
		CHUNK,
	)) {
		const result = await db.company.updateMany({
			where: { id: { in: batch } },
			data: { email: null },
		});
		cleared += result.count;
	}

	console.log(`Done. Cleared ${cleared} company emails.`);
	await db.$disconnect();
}

void main().catch(async (error: unknown) => {
	console.error(error);
	await db.$disconnect();
	process.exit(1);
});
