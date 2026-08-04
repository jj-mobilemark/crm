import { describe, expect, it } from "bun:test";
import {
	companyNameGuessFromDomain,
	hostsRelated,
} from "../src/companies/company-name-guess";
import {
	applySuggestion,
	pickStrongUniqueMatch,
	rankSimilar,
	recommendationScore,
	type SimilarMatch,
} from "../src/companies/company-similar";
import { normalizeCompanyName } from "../src/companies/company-name";

const base = {
	city: null as string | null,
	stateCode: null as string | null,
	iconUrl: null as string | null,
	sageCrmCompanyId: null as string | null,
	sage100CustomerNo: null as string | null,
	contactCount: 0,
	matchingDomainContactCount: 0,
};

describe("companyNameGuessFromDomain", () => {
	it("turns a host into spaced name tokens", () => {
		expect(companyNameGuessFromDomain("hitachirail-cd.com")).toBe(
			"hitachirail cd",
		);
		expect(companyNameGuessFromDomain("https://www.Acme-Widgets.io")).toBe(
			"acme widgets",
		);
	});
});

describe("hostsRelated", () => {
	it("treats hitachirail.com and hitachirail-cd.com as related", () => {
		expect(hostsRelated("hitachirail.com", "hitachirail-cd.com")).toBe(true);
		expect(hostsRelated("stripe.com", "hitachirail.com")).toBe(false);
	});
});

describe("rankSimilar + suggestion", () => {
	const hitachiRail = {
		...base,
		id: "1",
		name: "Hitachi Rail",
		domain: "hitachirail.com",
		sageCrmCompanyId: "13903",
		contactCount: 5,
	};

	const hitachiCd = {
		...base,
		id: "2",
		name: "HITACHI RAIL CD US LTD",
		domain: null as string | null,
		sageCrmCompanyId: "1253",
		sage100CustomerNo: "0001234",
		contactCount: 64,
		matchingDomainContactCount: 12,
	};

	it("scores related hosts as a strong domain-family hit", () => {
		const ranked = rankSimilar(hitachiRail, {
			domain: "hitachirail-cd.com",
			normalized: normalizeCompanyName("hitachirail cd"),
		});
		expect(ranked?.score).toBe(85);
		expect(ranked?.reason).toBe("domain");
		expect(ranked?.blocksCreate).toBe(false);
	});

	it("compact-matches Hitachi Rail from domain guess tokens", () => {
		const noDomain = { ...hitachiRail, domain: null };
		const ranked = rankSimilar(noDomain, {
			domain: null,
			normalized: normalizeCompanyName("hitachirail cd"),
		});
		expect(ranked?.score).toBe(75);
		expect(ranked?.reason).toBe("name");
	});

	it("recommends Sage 100 + matching-domain contacts over related host alone", () => {
		const rail = rankSimilar(hitachiRail, {
			domain: "hitachirail-cd.com",
			normalized: normalizeCompanyName("hitachirail cd"),
		});
		const cd = rankSimilar(hitachiCd, {
			domain: "hitachirail-cd.com",
			normalized: normalizeCompanyName("hitachirail cd"),
		});
		expect(rail).not.toBeNull();
		expect(cd).not.toBeNull();
		expect(recommendationScore(cd!, "hitachirail-cd.com")).toBeGreaterThan(
			recommendationScore(rail!, "hitachirail-cd.com"),
		);

		const suggested = applySuggestion([rail!, cd!], "hitachirail-cd.com");
		expect(suggested[0]?.id).toBe("2");
		expect(suggested[0]?.suggested).toBe(true);
		expect(suggested[0]?.suggestReason).toContain("Sage 100");
		expect(suggested[0]?.suggestReason).toContain("hitachirail-cd.com");
	});

	it("auto-attaches the suggested account when name scores are close", () => {
		const matches: SimilarMatch[] = applySuggestion(
			[
				{
					...hitachiRail,
					score: 85,
					reason: "domain",
					blocksCreate: false,
				},
				{
					...hitachiCd,
					score: 75,
					reason: "name",
					blocksCreate: false,
				},
			],
			"hitachirail-cd.com",
		);
		expect(pickStrongUniqueMatch(matches)?.id).toBe("2");
	});

	it("does not auto-attach when close and neither has account signals", () => {
		const a: SimilarMatch = {
			...hitachiRail,
			sage100CustomerNo: null,
			matchingDomainContactCount: 0,
			contactCount: 2,
			score: 85,
			reason: "domain",
			blocksCreate: false,
			suggested: false,
			suggestReason: null,
		};
		const b: SimilarMatch = {
			...hitachiRail,
			id: "2",
			name: "HITACHI RAIL CD US LTD",
			domain: null,
			sageCrmCompanyId: "1253",
			sage100CustomerNo: null,
			matchingDomainContactCount: 0,
			contactCount: 3,
			score: 75,
			reason: "name",
			blocksCreate: false,
			suggested: true,
			suggestReason: "3 contacts",
		};
		expect(pickStrongUniqueMatch([a, b])).toBeNull();
	});
});
