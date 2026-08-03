import { describe, expect, it } from "bun:test";
import { DealStage } from "@crm/db";
import {
	emailForAcctMgr,
	emailForSageUser,
	isPushEcho,
	mapCompany,
	mapCompanyTree,
	mapContact,
	mapOpportunity,
	mapSageDealStage,
	matchSageUserByName,
	sage100Display,
	sageStageForPush,
	sageUserIdForEmail,
	toSageCompanyFields,
	toSageOpportunityFields,
	toSagePersonFields,
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
		expect(mapped?.stateCode).toBe("IL");
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
			// Sage `total` is unused (empty); the deal value lives in `forecast`.
			total: "",
			forecast: "90000",
			certainty: "50",
			currency: "USD",
			stage: "Closed Won",
			status: "Won",
			type: "Key Opportunity",
			targetclose: "2026-03-15T00:00:00",
			closed: "2026-03-10T12:00:00",
			opened: "2026-01-05T09:30:00",
			assigneduserid: "27",
		});

		expect(mapped).not.toBeNull();
		expect(mapped?.sageCrmOpportunityId).toBe("383");
		expect(mapped?.sageCrmCompanyId).toBe("24");
		expect(mapped?.sageCrmPrimaryPersonId).toBe("5");
		expect(mapped?.name).toBe("249  PR-LTMWG944-SP716");
		// Amount = forecast (deal value); weighted = amount x certainty.
		expect(mapped?.amount).toBe("90000");
		expect(mapped?.weightedAmount).toBe("45000");
		expect(mapped?.probability).toBe(50);
		expect(mapped?.stage).toBe(DealStage.CLOSED_WON);
		expect(mapped?.sageStage).toBe("Closed Won");
		expect(mapped?.sageStatus).toBe("Won");
		expect(mapped?.dealType).toBe("Key Opportunity");
		expect(mapped?.sageAssignedUserId).toBe("27");
		expect(mapped?.expectedCloseDate?.toISOString()).toContain("2026-03-15");
		expect(mapped?.closedAt?.toISOString()).toContain("2026-03-10");
		expect(mapped?.openedAt?.toISOString()).toContain("2026-01-05");
	});

	it("falls back opened -> createddate for the creation date", () => {
		const mapped = mapOpportunity({
			opportunityid: "9",
			description: "x",
			primarycompanyid: "24",
			createddate: "2025-11-02T00:00:00",
		});
		expect(mapped?.openedAt?.toISOString()).toContain("2025-11-02");
	});

	it("takes amount from forecast, computes weighted, and handles no certainty", () => {
		const full = mapOpportunity({
			opportunityid: "1",
			description: "big deal",
			primarycompanyid: "24",
			forecast: "2987000",
			certainty: "50",
		});
		expect(full?.amount).toBe("2987000");
		expect(full?.weightedAmount).toBe("1493500");

		// No certainty -> we do not fabricate a weight.
		const noCert = mapOpportunity({
			opportunityid: "2",
			description: "x",
			primarycompanyid: "24",
			forecast: "1000",
		});
		expect(noCert?.amount).toBe("1000");
		expect(noCert?.weightedAmount).toBeNull();

		// Falls back to `total` only when `forecast` is blank.
		const fallback = mapOpportunity({
			opportunityid: "3",
			description: "x",
			primarycompanyid: "24",
			total: "500",
			certainty: "10",
		});
		expect(fallback?.amount).toBe("500");
		expect(fallback?.weightedAmount).toBe("50");
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
	it("shows only the customer number, dropping the unused AR division", () => {
		expect(sage100Display("00", "0011246")).toBe("0011246");
	});
	it("returns the customer number even without a division", () => {
		expect(sage100Display(null, "MME")).toBe("MME");
	});
	it("is null when there is no customer number", () => {
		expect(sage100Display("00", null)).toBeNull();
	});
});

describe("matchSageUserByName (acctmgr -> owner)", () => {
	it("matches known reps by last name + first initial", () => {
		expect(matchSageUserByName("Chris Talbert")?.sageId).toBe("31");
		expect(matchSageUserByName("Nino Barker")?.sageId).toBe("36");
	});

	it("ignores middle initials and name-format variance", () => {
		expect(matchSageUserByName("Ken F. Lukowski")?.sageId).toBe("27");
		expect(matchSageUserByName("Ken Lukowski")?.sageId).toBe("27");
	});

	it("leaves former reps, blanks, and junk unmatched", () => {
		expect(matchSageUserByName("Chris Wallgren")).toBeNull();
		expect(matchSageUserByName("Kyle Sertich")).toBeNull();
		expect(matchSageUserByName("Joe Moore")).toBeNull();
		expect(matchSageUserByName("Sale Rep Name")).toBeNull();
		expect(matchSageUserByName("")).toBeNull();
		expect(matchSageUserByName(null)).toBeNull();
	});

	it("emailForAcctMgr returns the matched rep's email or null", () => {
		expect(emailForAcctMgr("Chris Talbert")).toBe("ctalbert@mobilemark.com");
		expect(emailForAcctMgr("Kyle Sertich")).toBeNull();
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

describe("toSageOpportunityFields (local -> Sage)", () => {
	it("writes forecast/certainty/stage and keeps raw Sage stage when unchanged", () => {
		const fields = toSageOpportunityFields(
			{
				sageCrmOpportunityId: "557",
				name: "Jordan Test Push From Sales Tool",
				amount: "100",
				probability: 50,
				stage: DealStage.CONTRACT_SENT,
				sageStage: "Proposal",
				sageStatus: "In Progress",
				expectedCloseDate: new Date("2026-09-01T12:00:00"),
				ownerEmail: "ken@mobilemark.com",
				sageCrmCompanyId: "24",
				sageCrmPrimaryPersonId: null,
			},
			"update",
		);
		const byName = Object.fromEntries(fields.map((f) => [f.name, f.value]));
		expect(byName.opportunityid).toBe("557");
		expect(byName.description).toBe("Jordan Test Push From Sales Tool");
		expect(byName.forecast).toBe("100");
		expect(byName.certainty).toBe("50");
		expect(byName.stage).toBe("Proposal");
		expect(byName.status).toBe("In Progress");
		expect(byName.assigneduserid).toBe("27");
	});

	it("derives Sage stage on create when local stage has diverged", () => {
		const fields = toSageOpportunityFields(
			{
				sageCrmOpportunityId: null,
				name: "New deal",
				amount: "1",
				probability: 25,
				stage: DealStage.QUALIFIED_TO_BUY,
				sageStage: null,
				sageStatus: null,
				expectedCloseDate: null,
				ownerEmail: null,
				sageCrmCompanyId: "24",
				sageCrmPrimaryPersonId: "5",
			},
			"create",
		);
		const byName = Object.fromEntries(fields.map((f) => [f.name, f.value]));
		expect(byName.primarycompanyid).toBe("24");
		expect(byName.primarypersonid).toBe("5");
		expect(byName.stage).toBe("Investigation/Prospecting");
		expect(byName.status).toBe("In Progress");
		expect(byName.opportunityid).toBeUndefined();
	});
});

describe("toSageCompanyFields / toSagePersonFields", () => {
	it("updates a company by companyid", () => {
		const fields = toSageCompanyFields(
			{ sageCrmCompanyId: "24", name: "MOBILE MARK INC", website: "https://mobilemark.com" },
			"update",
		);
		expect(fields).toEqual([
			{ name: "companyid", value: "24" },
			{ name: "name", value: "MOBILE MARK INC" },
			{ name: "website", value: "https://mobilemark.com" },
		]);
	});

	it("creates a person under a parent company", () => {
		const fields = toSagePersonFields(
			{
				sageCrmContactId: null,
				firstName: "Pat",
				lastName: "Tester",
				title: "Rep",
				sageCrmCompanyId: "24",
			},
			"create",
		);
		expect(fields).toEqual([
			{ name: "companyid", value: "24" },
			{ name: "firstname", value: "Pat" },
			{ name: "lastname", value: "Tester" },
			{ name: "title", value: "Rep" },
		]);
	});
});

describe("sageStageForPush / sageUserIdForEmail / isPushEcho", () => {
	it("keeps Purchasing when it still maps to CONTRACT_SENT", () => {
		expect(
			sageStageForPush({
				stage: DealStage.CONTRACT_SENT,
				sageStage: "Purchasing",
				sageStatus: "In Progress",
			}),
		).toEqual({ stage: "Purchasing", status: "In Progress" });
	});

	it("resolves owner email back to a Sage user id", () => {
		expect(sageUserIdForEmail("ken@mobilemark.com")).toBe("27");
		expect(sageUserIdForEmail("nobody@example.com")).toBeNull();
	});

	it("treats a Sage update at/before sagePushedAt as our own echo", () => {
		const pushed = new Date("2026-08-03T12:00:00Z");
		expect(isPushEcho(new Date("2026-08-03T11:59:00Z"), pushed)).toBe(true);
		expect(isPushEcho(new Date("2026-08-03T12:00:00Z"), pushed)).toBe(true);
		expect(isPushEcho(new Date("2026-08-03T12:01:00Z"), pushed)).toBe(false);
		expect(isPushEcho(null, pushed)).toBe(false);
		expect(isPushEcho(pushed, null)).toBe(false);
	});
});
