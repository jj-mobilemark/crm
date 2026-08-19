/**
 * Re-apply Sage opportunity snapshots onto deals whose stage drifted
 * (echo-guard freeze). Dry-run by default.
 *
 *   bun run scripts/sage-repair-stale-echo.ts
 *   bun run scripts/sage-repair-stale-echo.ts --apply
 */
import "@crm/env/load";
import { DealStage, db } from "@crm/db";
import { mapOpportunity } from "../src/sage/sage.mappings";
import type { SageRecord } from "../src/sage/sage-xml";

const apply = process.argv.includes("--apply");

function isClosedStage(stage: DealStage): boolean {
	return (
		stage === DealStage.CLOSED_WON || stage === DealStage.CLOSED_LOST
	);
}

function resolvedClosedAt(mapped: {
	closedAt: Date | null;
	stage: DealStage;
	expectedCloseDate: Date | null;
	openedAt: Date | null;
}): Date | null {
	if (mapped.closedAt) return mapped.closedAt;
	if (!isClosedStage(mapped.stage)) return null;
	return mapped.expectedCloseDate ?? mapped.openedAt ?? null;
}

async function main() {
	const [deals, snapshots] = await Promise.all([
		db.deal.findMany({
			where: { sageCrmOpportunityId: { not: null } },
			select: {
				id: true,
				name: true,
				stage: true,
				sageStage: true,
				sageStatus: true,
				sageCrmOpportunityId: true,
				probability: true,
				closedAt: true,
			},
		}),
		db.sageRecordSnapshot.findMany({
			where: { entity: "opportunity" },
			select: { sageId: true, payload: true },
		}),
	]);

	const snapById = new Map(
		snapshots.map((row) => [row.sageId, row.payload]),
	);
	const drifted: {
		id: string;
		sageId: string;
		name: string;
		fromStage: DealStage;
		toStage: DealStage;
		fromSage: string;
		toSage: string;
	}[] = [];

	for (const deal of deals) {
		const sageId = deal.sageCrmOpportunityId;
		if (!sageId) continue;
		const payload = snapById.get(sageId);
		if (!payload || typeof payload !== "object") continue;
		const mapped = mapOpportunity(payload as SageRecord);
		if (!mapped) continue;
		if (
			mapped.stage === deal.stage &&
			(mapped.sageStage ?? null) === (deal.sageStage ?? null)
		) {
			continue;
		}
		drifted.push({
			id: deal.id,
			sageId,
			name: deal.name,
			fromStage: deal.stage,
			toStage: mapped.stage,
			fromSage: `${deal.sageStatus ?? "-"}/${deal.sageStage ?? "-"}`,
			toSage: `${mapped.sageStatus ?? "-"}/${mapped.sageStage ?? "-"}`,
		});

		if (!apply) continue;

		const stageChanged = deal.stage !== mapped.stage;
		await db.deal.update({
			where: { id: deal.id },
			data: {
				stage: mapped.stage,
				sageStage: mapped.sageStage,
				sageStatus: mapped.sageStatus,
				probability: mapped.probability,
				amount: mapped.amount,
				weightedAmount: mapped.weightedAmount,
				expectedCloseDate: mapped.expectedCloseDate,
				closedAt: resolvedClosedAt(mapped),
				sageUpdatedAt: mapped.sageUpdatedAt,
				...(stageChanged ? { stageChangedAt: new Date() } : {}),
			},
		});
		if (stageChanged) {
			await db.dealFieldChange.create({
				data: {
					dealId: deal.id,
					field: "stage",
					fromValue: deal.stage,
					toValue: mapped.stage,
					source: "sage",
				},
			});
		}
	}

	console.log(
		`${apply ? "applied" : "dry-run"}  drifted=${drifted.length} / ${deals.length}`,
	);
	for (const row of drifted) {
		console.log(
			`${row.sageId.padStart(6)}  ${row.fromStage} → ${row.toStage}  (${row.fromSage} → ${row.toSage})  ${row.name.slice(0, 50)}`,
		);
	}
}

main()
	.catch((err) => {
		console.error(err);
		process.exit(1);
	})
	.finally(() => db.$disconnect());
