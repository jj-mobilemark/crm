import { describe, expect, it } from "bun:test";
import { DealStage } from "@crm/db";
import {
	isUsableCloseDate,
	resolvedClosedAt,
} from "../src/sage/sage-closed-at";

const NOW = new Date("2026-09-11T19:00:00-05:00");

describe("isUsableCloseDate", () => {
	it("accepts today and the past, rejects tomorrow", () => {
		expect(isUsableCloseDate(new Date("2026-09-11T12:00:00"), NOW)).toBe(
			true,
		);
		expect(isUsableCloseDate(new Date("2026-07-30T12:00:00"), NOW)).toBe(
			true,
		);
		expect(isUsableCloseDate(new Date("2026-09-30T12:00:00"), NOW)).toBe(
			false,
		);
		expect(isUsableCloseDate(null, NOW)).toBe(false);
	});
});

describe("resolvedClosedAt", () => {
	it("clears open deals even when Sage has a closed date", () => {
		expect(
			resolvedClosedAt({
				stage: DealStage.QUALIFIED_TO_BUY,
				sageClosedAt: new Date("2026-08-01T12:00:00"),
				existingClosedAt: new Date("2026-08-01T12:00:00"),
				now: NOW,
			}),
		).toBeNull();
	});

	it("uses Sage closed when present and not future", () => {
		const sage = new Date("2026-07-30T12:00:00");
		expect(
			resolvedClosedAt({
				stage: DealStage.CLOSED_WON,
				sageClosedAt: sage,
				existingClosedAt: new Date("2026-09-29T12:00:00"),
				now: NOW,
			}),
		).toBe(sage);
	});

	it("rejects a future Sage closed and freezes a usable existing date", () => {
		const existing = new Date("2026-08-24T12:00:00");
		expect(
			resolvedClosedAt({
				stage: DealStage.CLOSED_WON,
				sageClosedAt: new Date("2026-09-23T12:00:00"),
				existingClosedAt: existing,
				now: NOW,
			}),
		).toBe(existing);
	});

	it("never copies targetclose or opened — first observe stamps now", () => {
		expect(
			resolvedClosedAt({
				stage: DealStage.CLOSED_WON,
				sageClosedAt: null,
				existingClosedAt: null,
				now: NOW,
			}),
		).toBe(NOW);
	});

	it("freezes an existing past closedAt when Sage closed is still empty", () => {
		const existing = new Date("2025-09-09T12:00:00");
		expect(
			resolvedClosedAt({
				stage: DealStage.CLOSED_WON,
				sageClosedAt: null,
				existingClosedAt: existing,
				now: NOW,
			}),
		).toBe(existing);
	});

	it("replaces a future existing closedAt (legacy targetclose) with now", () => {
		expect(
			resolvedClosedAt({
				stage: DealStage.CLOSED_WON,
				sageClosedAt: null,
				existingClosedAt: new Date("2026-09-30T12:00:00"),
				now: NOW,
			}),
		).toBe(NOW);
	});

	it("is idempotent: a later sync with no new Sage closed keeps the freeze", () => {
		const frozen = new Date("2026-09-03T12:00:00");
		expect(
			resolvedClosedAt({
				stage: DealStage.CLOSED_LOST,
				sageClosedAt: null,
				existingClosedAt: frozen,
				now: new Date("2026-09-20T19:00:00-05:00"),
			}),
		).toBe(frozen);
	});

	it("upgrades a frozen date when Sage later sends a real closed", () => {
		const sage = new Date("2026-09-03T12:00:00");
		expect(
			resolvedClosedAt({
				stage: DealStage.CLOSED_WON,
				sageClosedAt: sage,
				existingClosedAt: new Date("2026-09-11T19:00:00-05:00"),
				now: new Date("2026-09-20T19:00:00-05:00"),
			}),
		).toBe(sage);
	});
});
