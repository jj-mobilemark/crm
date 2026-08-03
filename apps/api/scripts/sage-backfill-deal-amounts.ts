/**
 * One-time: recompute imported deal Amount / Weighted from Sage `forecast`.
 *
 * The first backfill followed the wrong assumption that Sage `forecast` was
 * already weighted and `total` was the deal value. In this instance `total` is
 * unused (empty/0) and `forecast` IS the deal value, with a separate
 * `certainty` %. So:
 *
 *   amount   <- forecast (else total)      # the unweighted deal value
 *   weighted <- amount x certainty / 100   # the real weighted forecast
 *
 * Re-derives from the opportunity snapshots (no Sage calls) via `mapOpportunity`,
 * so it always matches the live mapping. Idempotent.
 *
 *   bun run scripts/sage-backfill-deal-amounts.ts
 */
import "@crm/env/load";
import { db } from "@crm/db";
import { mapOpportunity } from "../src/sage/sage.mappings";

async function main(): Promise<void> {
	const snapshots = await db.sageRecordSnapshot.findMany({
		where: { entity: "opportunity" },
		select: { payload: true },
	});

	let updated = 0;
	let skipped = 0;

	for (const snap of snapshots) {
		const mapped = mapOpportunity(snap.payload as Record<string, string>);
		if (!mapped) {
			skipped += 1;
			continue;
		}

		const result = await db.deal.updateMany({
			where: { sageCrmOpportunityId: mapped.sageCrmOpportunityId },
			data: {
				amount: mapped.amount,
				weightedAmount: mapped.weightedAmount,
				probability: mapped.probability,
			},
		});
		updated += result.count;
	}

	console.log("Deal amount/weighted recompute from Sage forecast:");
	console.log(`  snapshots read: ${snapshots.length}`);
	console.log(`  deals updated:  ${updated}`);
	console.log(`  skipped:        ${skipped}`);

	await db.$disconnect();
}

void main().catch(async (error: unknown) => {
	console.error(error);
	await db.$disconnect();
	process.exit(1);
});
