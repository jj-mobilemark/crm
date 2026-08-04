import { describe, expect, it } from "bun:test";
import { domainFromEmail, majorityWorkDomain, normalizeDomain } from "../src/companies/domain";

/**
 * Domain parsing stayed on this side when enrichment left.
 *
 * It is not enrichment: turning "  Ada@WWW.Stripe.com " into `stripe.com` is
 * how the CRM decides which company row an address belongs to, and that
 * question has an answer without asking anybody anything.
 */

describe("normalizeDomain", () => {
	it("reduces anything a human might type to the bare host", () => {
		for (const input of [
			"stripe.com",
			"STRIPE.com",
			"  stripe.com  ",
			"www.stripe.com",
			"https://stripe.com",
			"https://www.Stripe.com/pricing?ref=x",
			"http://stripe.com/",
		]) {
			expect(normalizeDomain(input)).toBe("stripe.com");
		}
	});

	it("rejects things that are not hostnames", () => {
		for (const input of [
			"",
			"   ",
			"localhost",
			"my company",
			"not a domain",
		]) {
			expect(normalizeDomain(input)).toBeNull();
		}
		expect(normalizeDomain(null)).toBeNull();
		expect(normalizeDomain(undefined)).toBeNull();
	});
});

describe("domainFromEmail", () => {
	it("takes the domain off a work address", () => {
		expect(domainFromEmail("ada@stripe.com")).toBe("stripe.com");
		expect(domainFromEmail("  Ada@WWW.Stripe.com ")).toBe("stripe.com");
	});

	it("ignores free and malformed addresses", () => {
		// Creating a "Gmail" company from a personal address is the classic
		// CRM junk row.
		for (const email of [
			"ada@gmail.com",
			"ada@outlook.com",
			"ada@proton.me",
			"@stripe.com",
			"not-an-email",
			"",
		]) {
			expect(domainFromEmail(email)).toBeNull();
		}
	});
});

describe("majorityWorkDomain", () => {
	it("picks the most common work domain", () => {
		expect(
			majorityWorkDomain([
				"a@cleverdevices.com",
				"b@cleverdevices.com",
				"c@other.com",
				"d@gmail.com",
				null,
			]),
		).toBe("cleverdevices.com");
	});

	it("returns null when nothing qualifies", () => {
		expect(majorityWorkDomain(["a@gmail.com", null, ""])).toBeNull();
	});
});
