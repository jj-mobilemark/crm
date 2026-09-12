import { describe, expect, it } from "bun:test";
import { DealStage } from "../src/generated/prisma/client";
import {
	PULSE_CHANGE_FILTERS,
	pulseChangeWhere,
	pulseOwnerWhere,
} from "../src/pipeline-pulse";

describe("pulseChangeWhere", () => {
	it("is empty for all or a missing filter", () => {
		expect(pulseChangeWhere("all")).toEqual({});
		expect(pulseChangeWhere(undefined)).toEqual({});
	});

	it("splits won and lost from other stage moves", () => {
		expect(pulseChangeWhere("won")).toEqual({
			field: "stage",
			toValue: DealStage.CLOSED_WON,
		});
		expect(pulseChangeWhere("lost")).toEqual({
			field: "stage",
			toValue: DealStage.CLOSED_LOST,
		});
		expect(pulseChangeWhere("stage")).toEqual({
			field: "stage",
			NOT: {
				toValue: { in: [DealStage.CLOSED_WON, DealStage.CLOSED_LOST] },
			},
		});
	});

	it("matches a stored field name for the other reasons", () => {
		expect(pulseChangeWhere("probability")).toEqual({ field: "probability" });
		expect(pulseChangeWhere("amount")).toEqual({ field: "amount" });
		expect(pulseChangeWhere("expectedCloseDate")).toEqual({
			field: "expectedCloseDate",
		});
		expect(pulseChangeWhere("ownerId")).toEqual({ field: "ownerId" });
		expect(pulseChangeWhere("priority")).toEqual({ field: "priority" });
		expect(pulseChangeWhere("sageStage")).toEqual({ field: "sageStage" });
	});

	it("lists every filter the overview URL accepts", () => {
		expect(PULSE_CHANGE_FILTERS).toEqual([
			"all",
			"won",
			"lost",
			"stage",
			"probability",
			"amount",
			"expectedCloseDate",
			"ownerId",
			"priority",
			"sageStage",
		]);
	});
});

describe("pulseOwnerWhere", () => {
	it("scopes Me to the acting user and ignores a leftover rep filter", () => {
		expect(pulseOwnerWhere("me", "user_abc", "other")).toEqual({
			ownerId: "user_abc",
		});
	});

	it("applies a rep filter only on Everyone", () => {
		expect(pulseOwnerWhere("everyone", "ignored")).toEqual({});
		expect(pulseOwnerWhere("everyone", "ignored", "rep_1")).toEqual({
			ownerId: "rep_1",
		});
	});

	it("requires userId when scope is Me", () => {
		expect(() => pulseOwnerWhere("me")).toThrow(/userId is required/);
		expect(() => pulseOwnerWhere("me", null)).toThrow(/userId is required/);
		expect(() => pulseOwnerWhere("me", "")).toThrow(/userId is required/);
	});
});
