/**
 * One-time: set company owners from Sage `acctmgr`, cascade to their contacts.
 *
 * The first full backfill (7.4b) did not map an owner onto companies/contacts —
 * only deals got one. Company owner in Sage is the free-text `acctmgr` NAME
 * (not a user id), which we resolve to one of the 11 `SAGE_USERS`. Unmatched
 * names (former reps, blanks, junk) are left owner-less by design.
 *
 * Reads `acctmgr` from the `SageRecordSnapshot` rows we already stored, so it
 * makes NO Sage calls. Idempotent and gentle: only fills owners that are
 * currently null — it never overwrites an owner a human has set.
 *
 *   bun run scripts/sage-backfill-owners.ts
 */
import "@crm/env/load";
import { db } from "@crm/db";
import { emailForAcctMgr, SAGE_USER_EMAILS } from "../src/sage/sage.mappings";

const CHUNK = 500;

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

async function main(): Promise<void> {
	// email -> local user id, for the known Sage owners.
	const emails = [...new Set(Object.values(SAGE_USER_EMAILS))];
	const users = await db.user.findMany({
		where: { email: { in: emails } },
		select: { id: true, email: true },
	});
	const userIdByEmail = new Map(users.map((u) => [u.email, u.id]));

	// sageCrmCompanyId -> { id, ownerId } for every Sage-linked company.
	const companies = await db.company.findMany({
		where: { sageCrmCompanyId: { not: null } },
		select: { id: true, sageCrmCompanyId: true, ownerId: true },
	});
	const companyBySageId = new Map(
		companies.map((c) => [c.sageCrmCompanyId as string, c]),
	);

	// acctmgr per company, straight from the snapshot JSON (no Sage calls).
	const rows = await db.$queryRaw<{ sageId: string; acctmgr: string | null }[]>`
		SELECT "sageId", payload->'company'->>'acctmgr' AS acctmgr
		FROM "sageRecordSnapshot"
		WHERE entity = 'company'
	`;

	// Bucket company ids by the owner we resolved.
	const companyIdsByOwner = new Map<string, string[]>();
	const unmatched = new Map<string, number>();
	let matchedCompanies = 0;

	for (const row of rows) {
		const company = companyBySageId.get(row.sageId);
		if (!company || company.ownerId) continue; // gone or already owned

		const email = emailForAcctMgr(row.acctmgr);
		const ownerId = email ? userIdByEmail.get(email) : undefined;
		if (!ownerId) {
			const name = row.acctmgr?.trim();
			if (name) unmatched.set(name, (unmatched.get(name) ?? 0) + 1);
			continue;
		}

		matchedCompanies += 1;
		const list = companyIdsByOwner.get(ownerId) ?? [];
		list.push(company.id);
		companyIdsByOwner.set(ownerId, list);
	}

	// Apply: company owner, then cascade to that company's owner-less contacts.
	let companiesUpdated = 0;
	let contactsUpdated = 0;

	for (const [ownerId, ids] of companyIdsByOwner) {
		for (const batch of chunk(ids, CHUNK)) {
			const c = await db.company.updateMany({
				where: { id: { in: batch }, ownerId: null },
				data: { ownerId },
			});
			companiesUpdated += c.count;

			const k = await db.contact.updateMany({
				where: { companyId: { in: batch }, ownerId: null },
				data: { ownerId },
			});
			contactsUpdated += k.count;
		}
	}

	console.log("Company-owner backfill from Sage acctmgr:");
	console.log(`  companies matched:  ${matchedCompanies}`);
	console.log(`  companies updated:  ${companiesUpdated}`);
	console.log(`  contacts updated:   ${contactsUpdated}`);
	console.log("  unmatched acctmgr names (left owner-less):");
	for (const [name, count] of [...unmatched].sort((a, b) => b[1] - a[1])) {
		console.log(`    ${count.toString().padStart(6)}  ${name}`);
	}

	await db.$disconnect();
}

void main().catch(async (error: unknown) => {
	console.error(error);
	await db.$disconnect();
	process.exit(1);
});
