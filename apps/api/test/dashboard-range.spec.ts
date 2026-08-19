import { describe, expect, it } from "bun:test";
import { resolveRange } from "../src/dashboard/dashboard.service";

describe("resolveRange this_month", () => {
	it("spans the full calendar month, not month-to-date", () => {
		const now = new Date(2026, 7, 18, 15, 47);
		const range = resolveRange(
			{ scope: "everyone", range: "this_month" },
			now,
		);

		expect(range.start).toEqual(new Date(2026, 7, 1));
		expect(range.end).toEqual(new Date(2026, 8, 1));
		expect(range.previousStart).toEqual(new Date(2026, 6, 1));
		expect(range.previousEnd).toEqual(new Date(2026, 7, 1));
		expect(range.windowDays).toBe(31);
	});

	it("still includes a Won deal whose close date is later this month", () => {
		const now = new Date(2026, 7, 18, 15, 47);
		const range = resolveRange(
			{ scope: "everyone", range: "this_month" },
			now,
		);
		const laterThisMonth = new Date(2026, 7, 28, 12);

		expect(laterThisMonth >= range.start).toBe(true);
		expect(laterThisMonth < range.end).toBe(true);
	});
});
