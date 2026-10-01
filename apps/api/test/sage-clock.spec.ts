import { describe, expect, it } from "bun:test";
import { SAGE_INCREMENTAL_OVERLAP_MS } from "../src/sage/sage.constants";
import { isPushEcho, mapOpportunity } from "../src/sage/sage.mappings";
import { fromSageClock, toSageClock } from "../src/sage/sage-clock";

describe("toSageClock", () => {
	it("formats an instant as Central wall time in summer (CDT)", () => {
		expect(toSageClock(new Date("2026-10-01T06:00:00Z"))).toBe(
			"2026-10-01T01:00:00",
		);
	});

	it("formats an instant as Central wall time in winter (CST)", () => {
		expect(toSageClock(new Date("2026-12-01T06:00:00Z"))).toBe(
			"2026-12-01T00:00:00",
		);
	});

	it("writes midnight as 00, not 24, and zero-pads every part", () => {
		expect(toSageClock(new Date("2026-01-05T09:04:09Z"))).toBe(
			"2026-01-05T03:04:09",
		);
		expect(toSageClock(new Date("2026-07-31T05:00:00Z"))).toBe(
			"2026-07-31T00:00:00",
		);
	});

	it("keeps the next nightly cursor at or before the previous run's start", () => {
		// cron-sage starts 06:00 UTC = 01:00 CDT. Opp 832 was saved at 01:04:57
		// Sage time, just after that run's query. The next run must still see it.
		const runStart = new Date("2026-09-30T06:00:00Z");
		const nextSince = new Date(
			runStart.getTime() - SAGE_INCREMENTAL_OVERLAP_MS,
		);
		const cursor = toSageClock(nextSince);
		expect(cursor <= toSageClock(runStart)).toBe(true);
		expect("2026-09-30T01:04:57" > cursor).toBe(true);
	});
});

describe("fromSageClock", () => {
	it("reads a summer Sage time as CDT", () => {
		expect(fromSageClock("2026-10-01T03:49:10")?.toISOString()).toBe(
			"2026-10-01T08:49:10.000Z",
		);
	});

	it("reads a winter Sage time as CST", () => {
		expect(fromSageClock("2026-11-29T21:00:00")?.toISOString()).toBe(
			"2026-11-30T03:00:00.000Z",
		);
	});

	it("round-trips with toSageClock across the DST change", () => {
		for (const iso of [
			"2026-03-08T07:59:59Z",
			"2026-03-08T08:00:00Z",
			"2026-11-01T05:59:59Z",
			"2026-11-01T08:00:00Z",
			"2026-07-30T21:50:58Z",
		]) {
			const instant = new Date(iso);
			expect(fromSageClock(toSageClock(instant))?.toISOString()).toBe(
				instant.toISOString(),
			);
		}
	});

	it("reads the repeated fall-back hour as the earlier instant", () => {
		// 01:30 on 1 Nov happens at 06:30Z (CDT) and again at 07:30Z (CST).
		// Earlier is the safe pick for a cursor: it re-reads, never skips.
		expect(fromSageClock("2026-11-01T01:30:00")?.toISOString()).toBe(
			"2026-11-01T06:30:00.000Z",
		);
	});

	it("returns null for blank or malformed values", () => {
		expect(fromSageClock(null)).toBeNull();
		expect(fromSageClock(undefined)).toBeNull();
		expect(fromSageClock("")).toBeNull();
		expect(fromSageClock("not a date")).toBeNull();
	});
});

describe("Sage updateddate on pull", () => {
	it("maps updateddate to the real instant", () => {
		const mapped = mapOpportunity({
			opportunityid: "664",
			description: "x",
			primarycompanyid: "24",
			updateddate: "2026-10-01T03:49:10",
		});
		expect(mapped?.sageUpdatedAt?.toISOString()).toBe(
			"2026-10-01T08:49:10.000Z",
		);
	});

	it("does not treat a Sage edit made after our push as our echo", () => {
		const pushedAt = new Date("2026-10-01T15:00:00Z");
		const mapped = mapOpportunity({
			opportunityid: "664",
			description: "x",
			primarycompanyid: "24",
			// 11:00 CDT = 16:00 UTC, one hour after the push.
			updateddate: "2026-10-01T11:00:00",
		});
		const pulledAt = new Date("2026-10-01T16:30:00Z");
		expect(isPushEcho(mapped?.sageUpdatedAt, pushedAt, pulledAt)).toBe(false);
	});
});
