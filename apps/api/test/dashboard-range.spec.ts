import { describe, expect, it } from "bun:test";
import {
	recentActivityWhere,
	resolveRange,
} from "../src/dashboard/dashboard.service";

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

describe("recentActivityWhere", () => {
	it("scopes Me to the acting user", () => {
		expect(recentActivityWhere(true, "user-1")).toEqual({
			createdById: "user-1",
		});
	});

	it("keeps other people's CRM log on Everyone, not their mailbox", () => {
		expect(recentActivityWhere(false, "user-1")).toEqual({
			OR: [
				{ createdById: "user-1" },
				{ emailThreadId: null, calendarEventId: null },
			],
		});
	});
});
