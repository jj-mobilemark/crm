import { describe, expect, it } from "bun:test";
import { DealStage } from "@crm/db";
import {
	emailForSageUser,
	mapCompany,
	mapCompanyTree,
	mapContact,
	mapOpportunity,
	mapSageDealStage,
	sage100Display,
} from "../src/sage/sage.mappings";

describe("mapCompany", () => {
	it("maps ids, name, Sage 100 key, and derives a domain from the website", () => {
		const mapped = mapCompany({
			companyid: "24",
			name: "MOBILE MARK INC",
			city: "Chicago",
			website: "https://www.mobilemark.com/products",
			mas_customerno: "0000777",
			mas_ardivisionno: "00",
			primarypersonid: "5",
		});

		expect(mapped).not.toBeNull();
		expect(mapped?.sageCrmCompanyId).toBe("24");
		expect(mapped?.name).toBe("MOBILE MARK INC");
		expect(mapped?.sage100CustomerNo).toBe("0000777");
		expect(mapped?.sage100ArDivisionNo).toBe("00");
		expect(mapped?.domain).toBe("mobilemark.com");
		expect(mapped?.city).toBe("Chicago");
		expect(mapped?.primaryPersonId).toBe("5");
	});

	it("falls back to companyname when name is blank", () => {
		const mapped = mapCompany({
			companyid: "1",
			companyname: "Fallback Name",
		});
		expect(mapped?.name).toBe("Fallback Name");
	});

	it("falls back to the email domain when there is no website", () => {
		const mapped = mapCompany({
			companyid: "9",
			name: "Acme",
			emailaddress: "sales@acme.co.uk",
		});
		expect(mapped?.domain).toBe("acme.co.uk");
	});

	it("returns null without a usable id or name", () => {
		expect(mapCompany({ name: "No id" })).toBeNull();
		expect(mapCompany({ companyid: "1", name: "  " })).toBeNull();
	});
});

describe("mapCompanyTree", () => {
	it("merges nested address, email and phone onto the company", () => {
		const mapped = mapCompanyTree({
			company: {
				companyid: "24",
				name: "MOBILE MARK INC",
				website: "https://www.mobilemark.com",
			},
			people: [],
			address: { city: "Itasca", state: "IL" },
			email: { emailaddress: "info@mobilemark.com" },
			phone: { areacode: "847", number: "671-6690" },
		});

		expect(mapped?.city).toBe("Itasca");
		expect(mapped?.email).toBe("info@mobilemark.com");
		expect(mapped?.phone).toBe("847 671-6690");
		expect(mapped?.domain).toBe("mobilemark.com");
	});
});

describe("mapContact", () => {
	it("maps name, lower-cases email, joins phone, and links the company", () => {
		const mapped = mapContact({
			personid: "5",
			companyid: "24",
			firstname: "Linda",
			lastname: "Clark",
			title: "Managing Director",
			emailaddress: "Linda@Example.COM",
			areacode: "312",
			number: "555-1000",
		});

		expect(mapped?.sageCrmContactId).toBe("5");
		expect(mapped?.sageCrmCompanyId).toBe("24");
		expect(mapped?.firstName).toBe("Linda");
		expect(mapped?.lastName).toBe("Clark");
		expect(mapped?.email).toBe("linda@example.com");
		expect(mapped?.phone).toBe("312 555-1000");
		expect(mapped?.title).toBe("Managing Director");
	});

	it("strips angle brackets from dirty Sage emails", () => {
		const mapped = mapContact({
			personid: "5",
			firstname: "Linda",
			emailaddress: "<Linda@Example.COM>",
		});
		expect(mapped?.email).toBe("linda@example.com");
	});

	it("uses the parent company id when the nested person has none", () => {
		const mapped = mapContact({ personid: "5", firstname: "Linda" }, "24");
		expect(mapped?.sageCrmCompanyId).toBe("24");
	});

	it("returns null without a usable id or first name", () => {
		expect(mapContact({ personid: "5" })).toBeNull();
	});
});

describe("mapOpportunity", () => {
	it("maps forecasting fields, stage, and company link", () => {
		const mapped = mapOpportunity({
			opportunityid: "383",
			description: "249  PR-LTMWG944-SP716",
			primarycompanyid: "24",
			primarypersonid: "5",
			total: "90000",
			forecast: "81008.4",
			certainty: "100",
			currency: "USD",
			stage: "Closed Won",
			status: "Won",
			type: "Key Opportunity",
			targetclose: "2026-03-15T00:00:00",
			closed: "2026-03-10T12:00:00",
			assigneduserid: "27",
		});

		expect(mapped).not.toBeNull();
		expect(mapped?.sageCrmOpportunityId).toBe("383");
		expect(mapped?.sageCrmCompanyId).toBe("24");
		expect(mapped?.sageCrmPrimaryPersonId).toBe("5");
		expect(mapped?.name).toBe("249  PR-LTMWG944-SP716");
		expect(mapped?.amount).toBe("90000");
		expect(mapped?.weightedAmount).toBe("81008.4");
		expect(mapped?.probability).toBe(100);
		expect(mapped?.stage).toBe(DealStage.CLOSED_WON);
		expect(mapped?.sageStage).toBe("Closed Won");
		expect(mapped?.sageStatus).toBe("Won");
		expect(mapped?.dealType).toBe("Key Opportunity");
		expect(mapped?.sageAssignedUserId).toBe("27");
		expect(mapped?.expectedCloseDate?.toISOString()).toContain("2026-03-15");
		expect(mapped?.closedAt?.toISOString()).toContain("2026-03-10");
	});

	it("returns null without id, description, or company", () => {
		expect(
			mapOpportunity({
				description: "x",
				primarycompanyid: "24",
			}),
		).toBeNull();
		expect(
			mapOpportunity({
				opportunityid: "1",
				primarycompanyid: "24",
			}),
		).toBeNull();
		expect(
			mapOpportunity({
				opportunityid: "1",
				description: "x",
			}),
		).toBeNull();
	});
});

describe("mapSageDealStage", () => {
	it("maps closed won / lost terminals", () => {
		expect(mapSageDealStage("Closed Won", "Won")).toBe(DealStage.CLOSED_WON);
		expect(mapSageDealStage("Lost", "Closed")).toBe(DealStage.CLOSED_LOST);
		expect(mapSageDealStage(null, "Lost")).toBe(DealStage.CLOSED_LOST);
	});

	it("maps active Sage stages into the HubSpot-style enum", () => {
		expect(mapSageDealStage("Investigation/Prospecting", "In Progress")).toBe(
			DealStage.QUALIFIED_TO_BUY,
		);
		expect(mapSageDealStage("Proposal", "In Progress")).toBe(
			DealStage.CONTRACT_SENT,
		);
		expect(mapSageDealStage("Negotiation", "In Progress")).toBe(
			DealStage.DECISION_MAKER_BOUGHT_IN,
		);
		expect(mapSageDealStage("Purchasing", "In Progress")).toBe(
			DealStage.CONTRACT_SENT,
		);
	});

	it("defaults blank / unknown to QUALIFIED_TO_BUY", () => {
		expect(mapSageDealStage(null, null)).toBe(DealStage.QUALIFIED_TO_BUY);
		expect(mapSageDealStage("Something New", "In Progress")).toBe(
			DealStage.QUALIFIED_TO_BUY,
		);
	});
});

describe("sage100Display", () => {
	it("joins division and customer number", () => {
		expect(sage100Display("00", "0000777")).toBe("00-0000777");
	});
	it("uses the customer number alone when there is no division", () => {
		expect(sage100Display(null, "MME")).toBe("MME");
	});
	it("is null when there is no customer number", () => {
		expect(sage100Display("00", null)).toBeNull();
	});
});

describe("emailForSageUser", () => {
	it("resolves known Sage user ids to emails", () => {
		expect(emailForSageUser("27")).toBe("ken@mobilemark.com");
		expect(emailForSageUser("0")).toBe("sales@antenna.com");
	});
	it("returns null for a former employee's unknown id", () => {
		expect(emailForSageUser("999")).toBeNull();
		expect(emailForSageUser(null)).toBeNull();
	});
});
