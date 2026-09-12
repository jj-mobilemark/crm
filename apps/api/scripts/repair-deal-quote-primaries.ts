/**
 * Repair `isPrimary` so colliding quote numbers have exactly one winner.
 *
 * Unique numbers stay false. Does not parse names for new attachments
 * except the observed `#Q260622-001 & 002` title (optional 002).
 *
 *   bun run scripts/repair-deal-quote-primaries.ts --dry-run
 *   bun run scripts/repair-deal-quote-primaries.ts
 */
import "@crm/env/load";
import { DealQuoteSource, db } from "@crm/db";
import {
	attachDealQuotes,
	reconcileQuotePrimaries,
} from "../src/deals/quote-number";

const dryRun = process.argv.includes("--dry-run");

const rows = await db.dealQuote.findMany({
	select: {
		quoteNumber: true,
		isPrimary: true,
		deal: { select: { name: true, sageCrmOpportunityId: true } },
	},
});

const byNumber = new Map<string, typeof rows>();
for (const row of rows) {
	const group = byNumber.get(row.quoteNumber) ?? [];
	group.push(row);
	byNumber.set(row.quoteNumber, group);
}

const collidingBefore = [...byNumber.entries()]
	.filter(([, group]) => group.length >= 2)
	.map(([quoteNumber, group]) => ({
		quoteNumber,
		deals: group.length,
		primaries: group.filter((row) => row.isPrimary).length,
	}))
	.toSorted((a, b) => a.quoteNumber.localeCompare(b.quoteNumber));

const neededRepair = collidingBefore
	.filter((row) => row.primaries !== 1)
	.map((row) => row.quoteNumber);

const named001And002 =
	(
		await db.deal.findMany({
			where: { name: { contains: "Q260622-001", mode: "insensitive" } },
			select: { id: true, name: true },
		})
	).find((deal) => /&\s*002\b/.test(deal.name)) ?? null;
const titleMatches002 = named001And002 !== null;

if (!dryRun) {
	if (titleMatches002 && named001And002) {
		await attachDealQuotes(db, named001And002.id, [
			{
				quoteNumber: "Q260622-002",
				source: DealQuoteSource.SAGE_DESCRIPTION,
			},
		]);
	}
	await reconcileQuotePrimaries(db);
}

const afterRows = dryRun
	? []
	: await db.dealQuote.findMany({
			where: {
				quoteNumber: {
					in: collidingBefore.map((row) => row.quoteNumber),
				},
				isPrimary: true,
			},
			select: {
				quoteNumber: true,
				deal: { select: { name: true, sageCrmOpportunityId: true } },
			},
			orderBy: { quoteNumber: "asc" },
		});

console.log(
	JSON.stringify(
		{
			dryRun,
			collidingBefore,
			neededRepair,
			named001And002: named001And002?.name ?? null,
			wouldAttach002: titleMatches002,
			afterPrimaries: afterRows.map((row) => ({
				quoteNumber: row.quoteNumber,
				sage: row.deal.sageCrmOpportunityId,
				name: row.deal.name,
			})),
		},
		null,
		2,
	),
);

await db.$disconnect();
