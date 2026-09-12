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
	reconcileQuotePrimaries,
} from "../src/deals/quote-number";

/** Observed title `#Q260622-001 & 002` — do not generalize `& NNN`. */
function isNamed001And002(name: string): boolean {
	return /Q260622-001/i.test(name) && /&\s*002\b/.test(name);
}

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

const named001And002 = deals.find((deal) => isNamed001And002(deal.name));
let attached002 = false;
if (named001And002 && !dryRun) {
	const added = await attachDealQuotes(db, named001And002.id, [
		{ quoteNumber: "Q260622-002", source: DealQuoteSource.SAGE_DESCRIPTION },
	]);
	attached002 = added > 0;
	quotesAdded += added;
}

const primaries = dryRun
	? { uniqueCleared: 0, collisions: 0 }
	: await reconcileQuotePrimaries(db);

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
			named001And002: named001And002?.name ?? null,
			attached002: dryRun
				? Boolean(named001And002)
				: attached002,
			primaries,
			examples,
		},
		null,
		2,
	),
);

await db.$disconnect();
