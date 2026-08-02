import { describe, expect, it } from "bun:test";
import { parseFault, parseRecords, parseSessionId } from "../src/sage/sage-xml";

const LOGON = `<?xml version="1.0" encoding="UTF-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><logonresponsetype xmlns="http://tempuri.org/type"><result><sessionid>199415257756022</sessionid></result></logonresponsetype></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

const FAULT = `<?xml version="1.0" encoding="UTF-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><SOAP-ENV:Fault><faultcode>SOAP-ENV:Server</faultcode><faultstring>Query failed to run successfully. </faultstring></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

// A company response nests its people/addresses inside the company record —
// exactly the shape the live server returns.
const COMPANY = `<?xml version="1.0" encoding="UTF-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><SOAP-ENV:Body><queryresponse xmlns="http://tempuri.org/type"><result><records xsi:type="typens:company" xmlns:typens="http://tempuri.org/type"><typens:companyid>24</typens:companyid><typens:name>MOBILE MARK INC</typens:name><typens:city>Chicago</typens:city><typens:mas_ardivisionno>00</typens:mas_ardivisionno><typens:mas_customerno>0000777</typens:mas_customerno><records xsi:type="typens:person"><typens:personid>5</typens:personid><typens:firstname>Linda</typens:firstname></records></records></result></queryresponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

const PEOPLE = `<?xml version="1.0" encoding="UTF-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><SOAP-ENV:Body><queryresponse xmlns="http://tempuri.org/type"><result><records xsi:type="typens:person" xmlns:typens="http://tempuri.org/type"><typens:personid>5</typens:personid><typens:companyid>24</typens:companyid><typens:firstname>Linda</typens:firstname><typens:lastname>Clark</typens:lastname></records><records xsi:type="typens:person" xmlns:typens="http://tempuri.org/type"><typens:personid>6</typens:personid><typens:firstname>Bob</typens:firstname></records></result></queryresponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

describe("sage-xml", () => {
	it("reads the session id from a logon response", () => {
		expect(parseSessionId(LOGON)).toBe("199415257756022");
		expect(parseSessionId(FAULT)).toBeNull();
	});

	it("reads a fault string and trims it", () => {
		expect(parseFault(FAULT)).toBe("Query failed to run successfully.");
		expect(parseFault(LOGON)).toBeNull();
	});

	it("returns a company's own scalar fields, not its nested children", () => {
		const rows = parseRecords(COMPANY, "company");
		expect(rows).toHaveLength(1);
		const company = rows[0];
		expect(company?.companyid).toBe("24");
		expect(company?.name).toBe("MOBILE MARK INC");
		expect(company?.mas_customerno).toBe("0000777");
		expect(company?.mas_ardivisionno).toBe("00");
		// The nested person must NOT leak into the company's fields.
		expect(company?.personid).toBeUndefined();
		expect(company?.firstname).toBeUndefined();
	});

	it("keeps leading zeros as strings (never coerces ids to numbers)", () => {
		expect(parseRecords(COMPANY, "company")[0]?.mas_ardivisionno).toBe("00");
	});

	it("parses multiple flat person records", () => {
		const rows = parseRecords(PEOPLE, "person");
		expect(rows.map((r) => r.personid)).toEqual(["5", "6"]);
		expect(rows[0]?.lastname).toBe("Clark");
	});

	it("filters by entity: a company doc has no top-level people", () => {
		expect(parseRecords(COMPANY, "person")).toEqual([]);
	});
});
