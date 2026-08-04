import { describe, expect, it } from "bun:test";
import { DealStage } from "@crm/db";
import {
	certaintyForStage,
	STAGE_CERTAINTY,
	weightedFromAmount,
} from "../src/deals/deal-stage";

describe("STAGE_CERTAINTY", () => {
	it("maps every DealStage", () => {
		for (const stage of Object.values(DealStage)) {
			expect(STAGE_CERTAINTY[stage]).toBeNumber();
		}
	});

	it("uses Sage-shaped percents for the open rail", () => {
		expect(certaintyForStage(DealStage.DEMO_BOOKED)).toBe(10);
		expect(certaintyForStage(DealStage.QUALIFIED_TO_BUY)).toBe(25);
		expect(certaintyForStage(DealStage.DECISION_MAKER_BOUGHT_IN)).toBe(50);
		expect(certaintyForStage(DealStage.CONTRACT_SENT)).toBe(75);
		expect(certaintyForStage(DealStage.IN_PURCHASING)).toBe(90);
		expect(certaintyForStage(DealStage.CLOSED_WON)).toBe(100);
		expect(certaintyForStage(DealStage.CLOSED_LOST)).toBe(0);
	});
});

describe("weightedFromAmount", () => {
	it("returns null when either side is missing", () => {
		expect(weightedFromAmount(null, 50)).toBeNull();
		expect(weightedFromAmount(100, null)).toBeNull();
	});

	it("multiplies amount by certainty %", () => {
		expect(weightedFromAmount(14121, 50)).toBe(7060.5);
		expect(weightedFromAmount(100, 75)).toBe(75);
	});
});
