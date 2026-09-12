/**
 * Attach canonical quote numbers from Sage snapshots + deal names.
 *
 * Additive. Does not delete human rows. Expands Sage comma shorthand.
 *
 *   bun run scripts/backfill-deal-quotes.ts --dry-run
 *   bun run scripts/backfill-deal-quotes.ts
 */
import "@crm/env/load";
import { DealQuoteSource, db } from "@crm/db";
import {
	attachDealQuotes,
	quotesFromSageRecord,
	quotesFromText,
} from "../src/deals/quote-number";

const dryRun = process.argv.includes("--dry-run");

function asRecord(payload: unknown): Record<string, unknown> {
	if (payload && typeof payload === "object" && !Array.isArray(payload)) {
		return payload as Record<string, unknown>;
	}
	return {};
}

const deals = await db.deal.findMany({
	select: {
		id: true,
		name: true,
		sageCrmOpportunityId: true,
	},
});

const snapshots = await db.sageRecordSnapshot.findMany({
	where: { entity: "opportunity" },
	select: { sageId: true, payload: true },
});
const snapshotBySageId = new Map(
	snapshots.map((row) => [row.sageId, asRecord(row.payload)]),
);

let dealsWithQuotes = 0;
let quotesAdded = 0;
let skipped = 0;
const examples: { name: string; numbers: string[] }[] = [];

for (const deal of deals) {
	const payload = deal.sageCrmOpportunityId
		? { ...snapshotBySageId.get(deal.sageCrmOpportunityId) }
		: {};
	if (typeof payload.description !== "string" || !payload.description.trim()) {
		payload.description = deal.name;
	}

	const parsed = [
		...quotesFromSageRecord(payload),
		...quotesFromText(deal.name, DealQuoteSource.SAGE_DESCRIPTION),
	];
	const unique = new Map(parsed.map((row) => [row.quoteNumber, row]));
	const quotes = [...unique.values()];

	if (quotes.length === 0) {
		skipped += 1;
		continue;
	}

	dealsWithQuotes += 1;
	if (examples.length < 8) {
		examples.push({
			name: deal.name,
			numbers: quotes.map((row) => row.quoteNumber),
		});
	}

	if (dryRun) {
		quotesAdded += quotes.length;
		continue;
	}

	quotesAdded += await attachDealQuotes(db, deal.id, quotes);
}

console.log(
	JSON.stringify(
		{
			dryRun,
			deals: deals.length,
			dealsWithQuotes,
			quotesAdded: dryRun
				? `${quotesAdded} would attach (max, before skipDuplicates)`
				: quotesAdded,
			skipped,
			examples,
		},
		null,
		2,
	),
);

await db.$disconnect();
