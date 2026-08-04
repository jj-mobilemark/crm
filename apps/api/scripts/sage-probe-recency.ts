/**
 * Follow-up: recent-usage + alternate entity names for Sage modules.
 *   bun run scripts/sage-probe-recency.ts
 */
import dns from "node:dns/promises";
import https from "node:https";
import { URL } from "node:url";
import "@crm/env/load";

const REQUEST_NS = "http://tempuri.org/";
const TYPE_NS = "http://tempuri.org/type";
const DNS = new dns.Resolver();
DNS.setServers(["8.8.8.8", "1.1.1.1"]);

const url = process.env.SAGE_SOAP_URL!;
const user = process.env.SAGE_SOAP_USER!;
const pass = process.env.SAGE_SOAP_PASSWORD!;

function escapeXml(v: string) {
	return v
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
function envelope(body: string, sid?: string) {
	const header = sid
		? `<soap:Header><tem:sessionheader><tem:sessionid>${escapeXml(sid)}</tem:sessionid></tem:sessionheader></soap:Header>`
		: "";
	return (
		`<?xml version="1.0" encoding="utf-8"?>` +
		`<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" ` +
		`xmlns:tem="${REQUEST_NS}" xmlns:typens="${TYPE_NS}" ` +
		`xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
		`${header}<soap:Body>${body}</soap:Body></soap:Envelope>`
	);
}
async function resolveIpv4(hostname: string) {
	return (await DNS.resolve4(hostname))[0]!;
}
async function post(action: string, xml: string) {
	const parsed = new URL(url);
	const ip = await resolveIpv4(parsed.hostname);
	const body = Buffer.from(xml, "utf8");
	return await new Promise<string>((resolve, reject) => {
		const req = https.request(
			{
				protocol: parsed.protocol,
				hostname: ip,
				servername: parsed.hostname,
				port: parsed.port || 443,
				path: `${parsed.pathname}${parsed.search}`,
				method: "POST",
				headers: {
					host: parsed.hostname,
					"content-type": "text/xml; charset=utf-8",
					soapaction: `"${REQUEST_NS}${action}"`,
					"content-length": body.length,
				},
				timeout: 45_000,
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c) => chunks.push(c));
				res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
			},
		);
		req.on("error", reject);
		req.on("timeout", () => req.destroy(new Error("timeout")));
		req.write(body);
		req.end();
	});
}
function faultOf(xml: string) {
	const raw = xml.match(/<faultstring>([\s\S]*?)<\/faultstring>/i)?.[1];
	return (
		raw
			?.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&amp;/g, "&")
			.trim() ?? null
	);
}
function sessionIdOf(xml: string) {
	return xml.match(/<sessionid>\s*([^<\s]+)\s*<\/sessionid>/i)?.[1] ?? null;
}
function moreOf(xml: string) {
	return /<more>\s*true\s*<\/more>/i.test(xml);
}
function recordCount(xml: string) {
	return (xml.match(/<(?:\w+:)?records\b/gi) ?? []).length;
}
function allTag(xml: string, local: string) {
	const re = new RegExp(
		`<(?:\\w+:)?${local}>([\\s\\S]*?)</(?:\\w+:)?${local}>`,
		"gi",
	);
	const out: string[] = [];
	let m: RegExpExecArray | null;
	while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
	return out;
}

async function q(sid: string, entity: string, pred: string) {
	const xml = await post(
		"query",
		envelope(
			`<tem:query><tem:queryString>${escapeXml(pred)}</tem:queryString>` +
				`<tem:Entity>${escapeXml(entity)}</tem:Entity></tem:query>`,
			sid,
		),
	);
	const fault = faultOf(xml);
	if (fault) return { entity, pred, fault, rows: 0, more: false, xml: "" };
	return {
		entity,
		pred,
		fault: null as string | null,
		rows: recordCount(xml),
		more: moreOf(xml),
		xml,
	};
}

const checks: [string, string][] = [
	["communication", "comm_updateddate > '2024-01-01' AND comm_deleted IS NULL"],
	["communication", "comm_updateddate > '2025-01-01' AND comm_deleted IS NULL"],
	["communication", "comm_updateddate > '2026-01-01' AND comm_deleted IS NULL"],
	["communication", "comm_datetime > '2024-01-01' AND comm_deleted IS NULL"],
	["communication", "comm_datetime > '2025-01-01' AND comm_deleted IS NULL"],
	["communication", "comm_datetime > '2026-01-01' AND comm_deleted IS NULL"],
	["notes", "note_updateddate > '2024-01-01'"],
	["notes", "note_updateddate > '2025-01-01'"],
	["notes", "note_updateddate > '2026-01-01'"],
	["notes", "note_createddate > '2024-01-01'"],
	["lead", "lead_updateddate > '2024-01-01' AND lead_deleted IS NULL"],
	["lead", "lead_updateddate > '2025-01-01' AND lead_deleted IS NULL"],
	["lead", "lead_updateddate > '2026-01-01' AND lead_deleted IS NULL"],
	["opportunity", "oppo_updateddate > '2026-01-01' AND oppo_deleted IS NULL"],
	["opportunity", "oppo_updateddate > '2026-07-01' AND oppo_deleted IS NULL"],
	["phone", "phon_updateddate > '2026-01-01'"],
	["email", "emai_updateddate > '2026-01-01'"],
	["address", "addr_updateddate > '2024-01-01'"],
	["quotes", "1=1"],
	["Quotes", "1=1"],
	["quote", "1=1"],
	["orders", "1=1"],
	["Orders", "1=1"],
	["order", "1=1"],
	["case", "1=1"],
	["Case", "1=1"],
	["cases", "1=1"],
	["MasHeader", "1=1"],
	["masheader", "1=1"],
	["MasOrderDetailHistory", "1=1"],
	["QuoteItems", "1=1"],
	["QuoteItem", "1=1"],
	["OpportunityItem", "1=1"],
	["CompanyLink", "1=1"],
	["PersonLink", "1=1"],
];

async function main() {
	const logon = await post(
		"logon",
		envelope(
			`<tem:logon><tem:Username>${escapeXml(user)}</tem:Username>` +
				`<tem:Password>${escapeXml(pass)}</tem:Password></tem:logon>`,
		),
	);
	if (faultOf(logon)) throw new Error(faultOf(logon)!);
	const sid = sessionIdOf(logon)!;
	console.log("session ok\n");

	try {
		for (const [entity, pred] of checks) {
			const r = await q(sid, entity, pred);
			if (r.fault) {
				console.log(
					`FAIL  ${entity.padEnd(24)} ${pred.slice(0, 58).padEnd(58)} | ${r.fault.slice(0, 90)}`,
				);
			} else {
				const dates = allTag(r.xml, "updateddate").slice(0, 3);
				const created = allTag(r.xml, "createddate").slice(0, 3);
				const datetimes = allTag(r.xml, "datetime").slice(0, 3);
				const types = allTag(r.xml, "type").slice(0, 5);
				const actions = allTag(r.xml, "action").slice(0, 5);
				console.log(
					`OK    ${entity.padEnd(24)} ${pred.slice(0, 58).padEnd(58)} | rows=${r.rows}${r.more ? "+" : ""} updated=[${dates.join(", ")}] created=[${created.join(", ")}] datetime=[${datetimes.join(", ")}] type=[${types.join("|")}] action=[${actions.join("|")}]`,
				);
			}
		}
	} finally {
		await post("logoff", envelope(`<tem:logoff/>`, sid));
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
