import { describe, expect, it } from "bun:test";
import {
	emailForSageUser,
	mapCompany,
	mapCompanyTree,
	mapContact,
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
