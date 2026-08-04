import { describe, expect, it } from "bun:test";
import { normalizeCompanyName } from "../src/companies/company-name";

describe("normalizeCompanyName", () => {
	it("collapses legal suffixes and punctuation", () => {
		expect(normalizeCompanyName("Acme, Inc.")).toBe("acme");
		expect(normalizeCompanyName("ACME LLC")).toBe("acme");
		expect(normalizeCompanyName("Acme Corporation")).toBe("acme");
		expect(normalizeCompanyName("  Acme   Widgets  Co. ")).toBe("acme widgets");
	});

	it("keeps distinctive words", () => {
		expect(normalizeCompanyName("Northwind Traders")).toBe("northwind traders");
	});
});
