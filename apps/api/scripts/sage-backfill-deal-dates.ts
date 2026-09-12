/**
 * RETIRED one-shot (2026-08-02). Do not re-run.
 *
 * Encodes the OLD closedAt rule (`closed` → `targetclose` → `opened`).
 * Live pull now uses `resolvedClosedAt` in `sage-closed-at.ts`: Sage `closed`
 * when real, else freeze an existing past date, else stamp now on first
 * observe. Never copy forecast/open dates. A historical rewrite of empty
 * Sage `closed` rows is a separate, approved backfill — not this script.
 *
 *   bun run scripts/sage-backfill-deal-dates.ts
 */
import "@crm/env/load";
import { DealStage, db } from "@crm/db";
import { mapOpportunity } from "../src/sage/sage.mappings";

function resolvedClosedAt(mapped: {
	closedAt: Date | null;
	expectedCloseDate: Date | null;
	openedAt: Date | null;
	stage: DealStage;
}): Date | null {
	if (mapped.closedAt) return mapped.closedAt;
	const isClosed =
		mapped.stage === DealStage.CLOSED_WON ||
		mapped.stage === DealStage.CLOSED_LOST;
	if (!isClosed) return null;
	return mapped.expectedCloseDate ?? mapped.openedAt ?? null;
}

async function main(): Promise<void> {
	const snapshots = await db.sageRecordSnapshot.findMany({
		where: { entity: "opportunity" },
		select: { sageId: true, payload: true },
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
				closedAt: resolvedClosedAt(mapped),
				...(mapped.openedAt ? { createdAt: mapped.openedAt } : {}),
			},
		});
		updated += result.count;
	}

	console.log("Deal date backfill from Sage opened/closed:");
	console.log(`  snapshots read:  ${snapshots.length}`);
	console.log(`  deals updated:   ${updated}`);
	console.log(`  snapshots skipped (unmappable): ${skipped}`);

	await db.$disconnect();
}

void main().catch(async (error: unknown) => {
	console.error(error);
	await db.$disconnect();
	process.exit(1);
});
