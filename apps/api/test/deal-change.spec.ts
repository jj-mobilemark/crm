import { describe, expect, test } from "bun:test";
import { DealStage } from "@crm/db";
import {
	type DealChangeSnapshot,
	DealChangeRecorder,
} from "../src/crm/deal-change.service";

/**
 * Diff detection without a live DB — exercise the serialize/compare path by
 * intercepting createMany.
 */
describe("DealChangeRecorder diffs", () => {
	test("records certainty and amount, skips unchanged stage", async () => {
		const rows: unknown[] = [];
		const db = {
			dealFieldChange: {
				createMany: async ({ data }: { data: unknown[] }) => {
					rows.push(...data);
					return { count: data.length };
				},
			},
		};

		const recorder = new DealChangeRecorder(db as never);
		const before: DealChangeSnapshot = {
			stage: DealStage.QUALIFIED_TO_BUY,
			probability: 50,
			amount: "1000.00",
			expectedCloseDate: null,
			ownerId: "u1",
			priority: null,
			sageStage: "Quote",
		};
		const after: DealChangeSnapshot = {
			...before,
			probability: 75,
			amount: 1500,
		};

		const count = await recorder.recordDiffs({
			dealId: "d1",
			before,
			after,
			source: "sage",
		});

		expect(count).toBe(2);
		expect(rows).toHaveLength(2);
		expect(rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					field: "probability",
					fromValue: "50",
					toValue: "75",
					source: "sage",
				}),
				expect.objectContaining({
					field: "amount",
					fromValue: "1000.00",
					toValue: "1500.00",
					source: "sage",
				}),
			]),
		);
	});

	test("treats equivalent money strings as unchanged", async () => {
		const rows: unknown[] = [];
		const db = {
			dealFieldChange: {
				createMany: async ({ data }: { data: unknown[] }) => {
					rows.push(...data);
					return { count: data.length };
				},
			},
		};

		const recorder = new DealChangeRecorder(db as never);
		const snap: DealChangeSnapshot = {
			stage: DealStage.CONTRACT_SENT,
			probability: 90,
			amount: "2000",
			expectedCloseDate: null,
			ownerId: "u1",
			priority: null,
			sageStage: null,
		};

		const count = await recorder.recordDiffs({
			dealId: "d1",
			before: snap,
			after: { ...snap, amount: 2000 },
			source: "app",
			actorUserId: "u1",
		});

		expect(count).toBe(0);
		expect(rows).toHaveLength(0);
	});
});
