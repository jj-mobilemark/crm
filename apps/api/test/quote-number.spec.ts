import { describe, expect, it } from "bun:test";
import { DealQuoteSource } from "@crm/db";
import {
	canonicalizeQuoteNumber,
	expandQuoteNumbers,
	pickPrimaryDealQuoteId,
	quotesFromSageRecord,
	quotesFromText,
} from "../src/deals/quote-number";
import type { QuotePrimaryCandidate } from "../src/deals/quote-number";

describe("canonicalizeQuoteNumber", () => {
	it("accepts a canonical id after trim and case fold", () => {
		expect(canonicalizeQuoteNumber("  q260622-003  ")).toBe("Q260622-003");
	});

	it("rejects shorthand, blanks, and quote-tool ids", () => {
		expect(canonicalizeQuoteNumber("Q260622-003,4,5")).toBeNull();
		expect(canonicalizeQuoteNumber("")).toBeNull();
		expect(canonicalizeQuoteNumber("403")).toBeNull();
		expect(canonicalizeQuoteNumber("Q260702")).toBeNull();
	});
});

describe("expandQuoteNumbers", () => {
	it("keeps a single canonical id", () => {
		expect(expandQuoteNumbers("Quote#Q260821-008")).toEqual(["Q260821-008"]);
	});

	it("expands Sage comma shorthand into full sibling ids", () => {
		expect(expandQuoteNumbers("#Q260622-003,4,5,6,7: Bosch")).toEqual([
			"Q260622-003",
			"Q260622-004",
			"Q260622-005",
			"Q260622-006",
			"Q260622-007",
		]);
	});

	it("does not store the shorthand string itself", () => {
		expect(expandQuoteNumbers("Q260622-003,4,5")).not.toContain(
			"Q260622-003,4,5",
		);
	});

	it("accepts already-padded comma tails and spaces", () => {
		expect(expandQuoteNumbers("Q260622-003, 004, 5")).toEqual([
			"Q260622-003",
			"Q260622-004",
			"Q260622-005",
		]);
	});

	it("keeps same-day siblings that are already full ids", () => {
		expect(
			expandQuoteNumbers("Q260622-003 and Q260622-007 plus Q260102-921"),
		).toEqual(["Q260622-003", "Q260622-007", "Q260102-921"]);
	});

	it("ignores junk name formats Analytics refused to parse", () => {
		expect(expandQuoteNumbers("Q260702")).toEqual([]);
		expect(expandQuoteNumbers("#Q260908-002/013")).toEqual(["Q260908-002"]);
		expect(expandQuoteNumbers("#Q260703-001 & 002")).toEqual(["Q260703-001"]);
		expect(expandQuoteNumbers("Q#Q260715-004")).toEqual(["Q260715-004"]);
	});

	it("dedupes and returns empty for blank", () => {
		expect(expandQuoteNumbers("Q260821-008 Q260821-008")).toEqual([
			"Q260821-008",
		]);
		expect(expandQuoteNumbers("")).toEqual([]);
		expect(expandQuoteNumbers(null)).toEqual([]);
	});
});

describe("quotesFromSageRecord", () => {
	it("prefers a quoting-tool note over the opportunity name", () => {
		expect(
			quotesFromSageRecord({
				description: "#Q260622-003,4,5,6,7: Bosch India",
				note: "Quote Q260228-001 created in Quoting Tool",
			}),
		).toEqual([
			{ quoteNumber: "Q260228-001", source: DealQuoteSource.SAGE_NOTE },
			{ quoteNumber: "Q260622-003", source: DealQuoteSource.SAGE_DESCRIPTION },
			{ quoteNumber: "Q260622-004", source: DealQuoteSource.SAGE_DESCRIPTION },
			{ quoteNumber: "Q260622-005", source: DealQuoteSource.SAGE_DESCRIPTION },
			{ quoteNumber: "Q260622-006", source: DealQuoteSource.SAGE_DESCRIPTION },
			{ quoteNumber: "Q260622-007", source: DealQuoteSource.SAGE_DESCRIPTION },
		]);
	});

	it("tags a quoting-tool stamp in description as SAGE_NOTE", () => {
		expect(
			quotesFromSageRecord({
				description: "Quote Q260228-001 created in Quoting Tool",
			}),
		).toEqual([
			{ quoteNumber: "Q260228-001", source: DealQuoteSource.SAGE_NOTE },
		]);
	});

	it("does not invent a match from amount-only or numeric quote_id", () => {
		expect(
			quotesFromSageRecord({
				description: "Bosch India",
				opportunityid: "663",
				forecast: "2987000",
			}),
		).toEqual([]);
	});
});

describe("pickPrimaryDealQuoteId", () => {
	const day = (day: number) => new Date(Date.UTC(2026, 8, day));

	function row(
		overrides: Partial<QuotePrimaryCandidate> &
			Pick<QuotePrimaryCandidate, "id" | "dealId">,
	): QuotePrimaryCandidate {
		return {
			quoteNumber: "Q260413-003",
			source: DealQuoteSource.SAGE_DESCRIPTION,
			createdAt: day(2),
			dealName: "Clone",
			quoteCountOnDeal: 3,
			...overrides,
		};
	}

	it("returns null when the number is unique", () => {
		expect(
			pickPrimaryDealQuoteId("Q260413-003", [
				row({ id: "a", dealId: "d1" }),
			]),
		).toBeNull();
	});

	it("prefers the deal whose name contains the full quote number", () => {
		expect(
			pickPrimaryDealQuoteId("Q260413-003", [
				row({
					id: "clone",
					dealId: "d1",
					dealName: "Copy of job",
					createdAt: day(1),
				}),
				row({
					id: "home",
					dealId: "d2",
					dealName: "Job Q260413-003",
					createdAt: day(5),
					quoteCountOnDeal: 8,
				}),
			]),
		).toBe("home");
	});

	it("then prefers the deal with fewer quotes", () => {
		expect(
			pickPrimaryDealQuoteId("Q260115-001", [
				row({
					id: "busy",
					dealId: "d1",
					quoteNumber: "Q260115-001",
					quoteCountOnDeal: 5,
					createdAt: day(1),
				}),
				row({
					id: "home",
					dealId: "d2",
					quoteNumber: "Q260115-001",
					quoteCountOnDeal: 1,
					createdAt: day(4),
				}),
			]),
		).toBe("home");
	});

	it("then prefers a note over a cloned description", () => {
		expect(
			pickPrimaryDealQuoteId("Q260115-001", [
				row({
					id: "desc",
					dealId: "d1",
					quoteNumber: "Q260115-001",
					source: DealQuoteSource.SAGE_DESCRIPTION,
					createdAt: day(1),
					quoteCountOnDeal: 1,
				}),
				row({
					id: "note",
					dealId: "d2",
					quoteNumber: "Q260115-001",
					source: DealQuoteSource.SAGE_NOTE,
					createdAt: day(4),
					quoteCountOnDeal: 1,
				}),
			]),
		).toBe("note");
	});

	it("then keeps the first attached clone (stable, not a person guess)", () => {
		expect(
			pickPrimaryDealQuoteId("Q260413-003", [
				row({ id: "later", dealId: "d2", createdAt: day(8) }),
				row({ id: "first", dealId: "d1", createdAt: day(1) }),
			]),
		).toBe("first");
	});
});

describe("quotesFromText", () => {
	it("marks pasted shorthand as the given source", () => {
		expect(quotesFromText("Q260622-003,4,5", DealQuoteSource.HUMAN)).toEqual([
			{ quoteNumber: "Q260622-003", source: DealQuoteSource.HUMAN },
			{ quoteNumber: "Q260622-004", source: DealQuoteSource.HUMAN },
			{ quoteNumber: "Q260622-005", source: DealQuoteSource.HUMAN },
		]);
	});
});
