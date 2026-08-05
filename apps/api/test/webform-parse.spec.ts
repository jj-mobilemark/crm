import { describe, expect, it } from "bun:test";
import {
	isCustomerQuestionSubject,
	parseCustomerQuestionBody,
} from "../src/screening/webform-parse";

const labeledHtml = `
<p><b>Name:</b> Darren Dragish</p>
<p><b>Your Location:</b><br>Malvern, PA<br>United States</p>
<p><b>Company Name:</b> Rajant Corporation</p>
<p><b>Choose a Location to Connect with:</b> North America</p>
<p><b>Email Address:</b> <a href="mailto:ddragish@rajant.com">ddragish@rajant.com</a></p>
<p><b>Phone:</b> (484) 595-0233</p>
<p><b>Comments/Questions:</b> Please quote cost and lead time for 10/25/100 pcs of PSGN-2000S. Thank you!</p>
<p><b>Where did you hear about Mobile Mark?:</b> Distributor or Partner</p>
`;

const footerText = `
Name
Armando Dominguez
Email
Purchase@sromexgroup.com
Questions/Comments
Dear Sales, My name is Armando Dominguez, Procurement Manager at SROMEX GROUP MEXICO. We are currently executing an ongoing project that requires 5G Sub-6 incl CBRS.
`;

describe("parseCustomerQuestionBody", () => {
	it("parses the labeled North America form", () => {
		const lead = parseCustomerQuestionBody(labeledHtml, "html");
		expect(lead?.email).toBe("ddragish@rajant.com");
		expect(lead?.displayName).toBe("Darren Dragish");
		expect(lead?.companyName).toBe("Rajant Corporation");
		expect(lead?.connectLocation).toBe("North America");
		expect(lead?.phone).toContain("484");
		expect(lead?.comments).toContain("PSGN-2000S");
		expect(lead?.locationText).toContain("Malvern");
	});

	it("parses the footer Customer Question layout", () => {
		const lead = parseCustomerQuestionBody(footerText, "text");
		expect(lead?.email).toBe("purchase@sromexgroup.com");
		expect(lead?.displayName).toBe("Armando Dominguez");
		expect(lead?.companyName).toContain("SROMEX");
		expect(lead?.comments).toContain("5G Sub-6");
	});
});

describe("isCustomerQuestionSubject", () => {
	it("matches Customer Question subjects including FW", () => {
		expect(
			isCustomerQuestionSubject(
				"FW: Customer Question From Mobile Mark Footer on Website",
			),
		).toBe(true);
		expect(
			isCustomerQuestionSubject(
				"Customer Question From Mobile Mark Website related to North America or Other",
			),
		).toBe(true);
		expect(isCustomerQuestionSubject("Re: Quote request")).toBe(false);
	});
});
