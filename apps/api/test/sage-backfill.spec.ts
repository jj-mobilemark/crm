import { describe, expect, it } from "bun:test";
import { SAGE_USER_EMAILS, SAGE_USERS } from "../src/sage/sage.mappings";
import {
	countMappableContacts,
	maxNumericId,
} from "../src/sage/sage-backfill.util";

describe("SAGE_USERS", () => {
	it("has the 11 team members and derives SAGE_USER_EMAILS from them", () => {
		expect(SAGE_USERS).toHaveLength(11);
		// The derived map never drifts from the list.
		for (const user of SAGE_USERS) {
			expect(SAGE_USER_EMAILS[user.sageId]).toBe(user.email);
		}
		expect(Object.keys(SAGE_USER_EMAILS)).toHaveLength(SAGE_USERS.length);
		// Ken is Sage 27 (the fallback owner, and Jordan's stand-in).
		expect(SAGE_USER_EMAILS["27"]).toBe("ken@mobilemark.com");
	});
});

describe("maxNumericId", () => {
	it("keeps the larger numeric id", () => {
		expect(maxNumericId(null, "24")).toBe("24");
		expect(maxNumericId("24", "9")).toBe("24");
		expect(maxNumericId("24", "557")).toBe("557");
	});

	it("ignores blank / non-numeric candidates", () => {
		expect(maxNumericId("24", undefined)).toBe("24");
		expect(maxNumericId("24", "")).toBe("24");
		expect(maxNumericId("24", "abc")).toBe("24");
		expect(maxNumericId(null, undefined)).toBeNull();
	});
});

describe("countMappableContacts", () => {
	it("counts only people that map to a real Contact", () => {
		const count = countMappableContacts({
			company: { companyid: "24", name: "MOBILE MARK INC" },
			people: [
				{ personid: "5", firstname: "Linda" },
				{ personid: "6", firstname: "Sam", lastname: "Lee" },
				// No first name -> mapContact returns null -> not counted.
				{ personid: "7" },
			],
			address: null,
			email: null,
			phone: null,
		});
		expect(count).toBe(2);
	});
});
