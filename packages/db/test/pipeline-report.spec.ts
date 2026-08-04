import { describe, expect, it } from "bun:test";
import {
	calendarMonthBounds,
	parseYearMonth,
	reportOwnerWhere,
	REPORT_DEAL_LIMIT,
} from "../src/pipeline-report";

/**
 * Pure helpers for pipeline reports — month bounds and Me/Everyone scope.
 * The loader's SQL lives behind Prisma; these are the bits that must not drift
 * from the overview dashboard's local calendar months.
 */
describe("parseYearMonth", () => {
	it("parses a real YYYY-MM", () => {
		expect(parseYearMonth("2026-08")).toEqual({ year: 2026, monthIndex: 7 });
		expect(parseYearMonth("2026-01")).toEqual({ year: 2026, monthIndex: 0 });
		expect(parseYearMonth("2026-12")).toEqual({ year: 2026, monthIndex: 11 });
	});

	it("rejects malformed or impossible months", () => {
		expect(parseYearMonth("2026-13")).toBeNull();
		expect(parseYearMonth("2026-00")).toBeNull();
		expect(parseYearMonth("26-08")).toBeNull();
		expect(parseYearMonth("2026-8")).toBeNull();
		expect(parseYearMonth("August 2026")).toBeNull();
		expect(parseYearMonth("")).toBeNull();
	});
});

describe("calendarMonthBounds", () => {
	it("returns local inclusive start and exclusive end", () => {
		const { start, end } = calendarMonthBounds(2026, 7);
		expect(start.getFullYear()).toBe(2026);
		expect(start.getMonth()).toBe(7);
		expect(start.getDate()).toBe(1);
		expect(start.getHours()).toBe(0);
		expect(end.getFullYear()).toBe(2026);
		expect(end.getMonth()).toBe(8);
		expect(end.getDate()).toBe(1);
	});

	it("rolls December into the next year", () => {
		const { start, end } = calendarMonthBounds(2026, 11);
		expect(start.getFullYear()).toBe(2026);
		expect(start.getMonth()).toBe(11);
		expect(end.getFullYear()).toBe(2027);
		expect(end.getMonth()).toBe(0);
	});
});

describe("reportOwnerWhere", () => {
	it("filters to the acting user for Me", () => {
		expect(reportOwnerWhere("me", "user_abc")).toEqual({ ownerId: "user_abc" });
	});

	it("applies no owner filter for Everyone", () => {
		expect(reportOwnerWhere("everyone")).toEqual({});
		expect(reportOwnerWhere("everyone", "ignored")).toEqual({});
	});

	it("requires userId when scope is Me", () => {
		expect(() => reportOwnerWhere("me")).toThrow(/userId is required/);
		expect(() => reportOwnerWhere("me", null)).toThrow(/userId is required/);
		expect(() => reportOwnerWhere("me", "")).toThrow(/userId is required/);
	});
});

describe("REPORT_DEAL_LIMIT", () => {
	it("caps the deal list at 40", () => {
		expect(REPORT_DEAL_LIMIT).toBe(40);
	});
});
