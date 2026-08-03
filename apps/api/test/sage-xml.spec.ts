import { describe, expect, it } from "bun:test";
import {
	parseAddId,
	parseCompanyPage,
	parseCompanyTrees,
	parseFault,
	parseMore,
	parseRecords,
	parseSessionId,
	parseUpdateResult,
} from "../src/sage/sage-xml";

const LOGON = `<?xml version="1.0" encoding="UTF-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><logonresponsetype xmlns="http://tempuri.org/type"><result><sessionid>199415257756022</sessionid></result></logonresponsetype></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

const FAULT = `<?xml version="1.0" encoding="UTF-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><SOAP-ENV:Fault><faultcode>SOAP-ENV:Server</faultcode><faultstring>Query failed to run successfully. </faultstring></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

// A company response nests its people/addresses inside the company record —
// exactly the shape the live server returns.
const COMPANY = `<?xml version="1.0" encoding="UTF-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><SOAP-ENV:Body><queryresponse xmlns="http://tempuri.org/type"><result><more>false</more><records xsi:type="typens:company" xmlns:typens="http://tempuri.org/type"><typens:companyid>24</typens:companyid><typens:name>MOBILE MARK INC</typens:name><typens:city>Chicago</typens:city><typens:mas_ardivisionno>00</typens:mas_ardivisionno><typens:mas_customerno>0000777</typens:mas_customerno><typens:primarypersonid>5</typens:primarypersonid><records xsi:type="typens:person"><typens:personid>5</typens:personid><typens:firstname>Linda</typens:firstname><typens:lastname>Clark</typens:lastname><records xsi:type="typens:email"><typens:emailaddress>linda@mobilemark.com</typens:emailaddress></records><records xsi:type="typens:phone"><typens:areacode>847</typens:areacode><typens:number>555-1000</typens:number></records></records><records xsi:type="typens:address"><typens:address1>1140 W Thorndale</typens:address1><typens:city>Itasca</typens:city><typens:state>IL</typens:state></records><records xsi:type="typens:email"><typens:emailaddress>info@mobilemark.com</typens:emailaddress></records><records xsi:type="typens:phone"><typens:areacode>847</typens:areacode><typens:number>671-6690</typens:number></records></records></result></queryresponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

const COMPANY_WRAPPED = `<?xml version="1.0" encoding="UTF-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><SOAP-ENV:Body><queryresponse xmlns="http://tempuri.org/type"><result><more>true</more><records xsi:type="typens:company" xmlns:typens="http://tempuri.org/type"><typens:companyid>99</typens:companyid><typens:name>Wrapped Co</typens:name><typens:people><records xsi:type="typens:person"><typens:personid>7</typens:personid><typens:firstname>Pat</typens:firstname></records></typens:people></records></result></queryresponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

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

	it("reads the <more> flag", () => {
		expect(parseMore(COMPANY)).toBe(false);
		expect(parseMore(COMPANY_WRAPPED)).toBe(true);
		expect(parseMore(FAULT)).toBe(false);
	});

	it("parses a hierarchical company with nested people/address/email/phone", () => {
		const trees = parseCompanyTrees(COMPANY);
		expect(trees).toHaveLength(1);
		const tree = trees[0];
		expect(tree?.company.companyid).toBe("24");
		expect(tree?.company.name).toBe("MOBILE MARK INC");
		expect(tree?.people).toHaveLength(1);
		expect(tree?.people[0]?.personid).toBe("5");
		expect(tree?.people[0]?.firstname).toBe("Linda");
		// Person nested email/phone stay on the person — not stolen by the company.
		expect(tree?.people[0]?.emailaddress).toBe("linda@mobilemark.com");
		expect(tree?.people[0]?.areacode).toBe("847");
		expect(tree?.people[0]?.number).toBe("555-1000");
		expect(tree?.address?.city).toBe("Itasca");
		expect(tree?.email?.emailaddress).toBe("info@mobilemark.com");
		expect(tree?.phone?.areacode).toBe("847");
		expect(tree?.phone?.number).toBe("671-6690");
	});

	it("parses people nested under a named <people> wrapper", () => {
		const trees = parseCompanyTrees(COMPANY_WRAPPED);
		expect(trees[0]?.people[0]?.personid).toBe("7");
		expect(trees[0]?.people[0]?.firstname).toBe("Pat");
	});

	it("returns companies plus more from parseCompanyPage", () => {
		const page = parseCompanyPage(COMPANY_WRAPPED);
		expect(page.more).toBe(true);
		expect(page.companies).toHaveLength(1);
	});

	it("reads updatesuccess / numberupdated from an update response", () => {
		const xml = `<?xml version="1.0"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><updateresponse xmlns="http://tempuri.org/type"><result><numberupdated>1</numberupdated><updatesuccess>true</updatesuccess></result></updateresponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
		expect(parseUpdateResult(xml)).toEqual({
			success: true,
			numberUpdated: 1,
		});
	});

	it("reads the new crmid from an add response", () => {
		const xml = `<?xml version="1.0"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><SOAP-ENV:Body><addresponse xmlns="http://tempuri.org/type"><result><records xsi:type="typens:crmid" xmlns:typens="http://tempuri.org/type"><crmid>805</crmid></records></result></addresponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
		expect(parseAddId(xml)).toBe("805");
		expect(parseAddId(FAULT)).toBeNull();
	});
});
