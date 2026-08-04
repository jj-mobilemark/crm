/**
 * Read-only: probe Sage SOAP for entity availability + recent usage.
 *
 * Checks modules beyond company/person/opportunity (UI tabs + plan §3c).
 * One session only: logon → probe → logoff.
 *
 * Uses node:https + public DNS (Bun fetch cannot resolve crm.mobilemark.com
 * on some local networks).
 *
 *   bun run scripts/sage-probe-entities.ts
 */
import dns from "node:dns/promises";
import https from "node:https";
import { URL } from "node:url";
import "@crm/env/load";

const URL_ENV = process.env.SAGE_SOAP_URL;
const USER_ENV = process.env.SAGE_SOAP_USER;
const PASS_ENV = process.env.SAGE_SOAP_PASSWORD;
const REQUEST_NS = "http://tempuri.org/";
const TYPE_NS = "http://tempuri.org/type";
const TIMEOUT_MS = 45_000;

/** Public resolvers — local DNS often cannot resolve crm.mobilemark.com. */
const DNS = new dns.Resolver();
DNS.setServers(["8.8.8.8", "1.1.1.1"]);

type ProbeAttempt = {
	entity: string;
	/** Predicates to try in order until one returns rows or a decisive fault. */
	predicates: string[];
};

/**
 * UI tabs from person/company record + plan §3c extras.
 * Address/phone/email arrive nested under company today; still probe standalone.
 */
const PROBES: ProbeAttempt[] = [
	// Already synced triad (sanity + baseline volume signal)
	{
		entity: "company",
		predicates: ["comp_deleted IS NULL", "comp_companyid > 0"],
	},
	{
		entity: "person",
		predicates: ["pers_deleted IS NULL", "pers_personid > 0"],
	},
	{
		entity: "opportunity",
		predicates: ["oppo_deleted IS NULL", "oppo_opportunityid > 0"],
	},

	// Record tabs / adjacent modules
	{
		entity: "communication",
		predicates: [
			"comm_deleted IS NULL",
			"comm_communicationid > 0",
			"Comm_Deleted IS NULL",
		],
	},
	{
		entity: "note",
		predicates: ["note_noteid > 0", "Note_NoteId > 0", "note_deleted IS NULL"],
	},
	{
		entity: "notes",
		predicates: ["note_noteid > 0", "notes_noteid > 0"],
	},
	{
		entity: "case",
		predicates: [
			"case_deleted IS NULL",
			"case_caseid > 0",
			"Case_CaseId > 0",
			"case_caseid IS NOT NULL",
		],
	},
	{
		entity: "cases",
		predicates: ["case_caseid > 0"],
	},
	{
		entity: "library",
		predicates: [
			"libr_libraryid > 0",
			"Libr_LibraryId > 0",
			"libr_deleted IS NULL",
		],
	},
	{
		entity: "librarylist",
		predicates: ["libr_libraryid > 0", "Libr_LibraryId > 0"],
	},
	{
		entity: "document",
		predicates: ["docu_documentid > 0", "documentid > 0"],
	},
	{
		entity: "documents",
		predicates: ["docu_documentid > 0"],
	},
	{
		entity: "relationship",
		predicates: [
			"rela_relationshipid > 0",
			"Rela_RelationshipId > 0",
			"rela_deleted IS NULL",
		],
	},
	{
		entity: "relationships",
		predicates: ["rela_relationshipid > 0"],
	},
	{
		entity: "consent",
		predicates: [
			"cnsn_consentid > 0",
			"Consent_ConsentId > 0",
			"cnsn_deleted IS NULL",
		],
	},
	{
		entity: "address",
		predicates: ["addr_addressid > 0", "Addr_AddressId > 0"],
	},
	{
		entity: "phone",
		predicates: ["phon_phoneid > 0", "Phon_PhoneId > 0"],
	},
	{
		entity: "email",
		predicates: ["emai_emailid > 0", "Emai_EmailId > 0"],
	},
	{
		entity: "lead",
		predicates: [
			"lead_deleted IS NULL",
			"lead_leadid > 0",
			"Lead_LeadId > 0",
		],
	},
	{
		entity: "quote",
		predicates: [
			"quot_deleted IS NULL",
			"quot_quoteid > 0",
			"Quot_QuoteId > 0",
		],
	},
	{
		entity: "quotes",
		predicates: ["quot_quoteid > 0", "Quot_QuoteId > 0"],
	},
	{
		entity: "order",
		predicates: [
			"orde_deleted IS NULL",
			"orde_orderid > 0",
			"Orde_OrderId > 0",
		],
	},
	{
		entity: "orders",
		predicates: ["orde_orderid > 0"],
	},
	{
		entity: "user",
		predicates: ["user_userid > 0", "User_UserId > 0", "user_logon IS NOT NULL"],
	},
	{
		entity: "users",
		predicates: ["user_userid > 0"],
	},
	{
		entity: "forecast",
		predicates: ["fore_forecastid > 0", "Fore_ForecastId > 0"],
	},
	{
		entity: "campaign",
		predicates: ["camp_campaignid > 0", "Camp_CampaignId > 0"],
	},
	{
		entity: "selfservice",
		predicates: ["self_selfserviceid > 0"],
	},
	{
		entity: "solution",
		predicates: ["soln_solutionid > 0", "Soln_SolutionId > 0"],
	},
	// ERP / order history (plan §3c)
	{
		entity: "MasHeader",
		predicates: ["1=1", "mas_customerno IS NOT NULL"],
	},
	{
		entity: "MasOrderDetailHistory",
		predicates: ["1=1"],
	},
	{
		entity: "MasOrderHistory",
		predicates: ["1=1"],
	},
];

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function envelope(body: string, sessionId?: string): string {
	const header = sessionId
		? `<soap:Header><tem:sessionheader><tem:sessionid>${escapeXml(sessionId)}</tem:sessionid></tem:sessionheader></soap:Header>`
		: "";
	return (
		`<?xml version="1.0" encoding="utf-8"?>` +
		`<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" ` +
		`xmlns:tem="${REQUEST_NS}" xmlns:typens="${TYPE_NS}" ` +
		`xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
		`${header}<soap:Body>${body}</soap:Body></soap:Envelope>`
	);
}

async function resolveIpv4(hostname: string): Promise<string> {
	const addrs = await DNS.resolve4(hostname);
	if (!addrs[0]) throw new Error(`No A record for ${hostname}`);
	return addrs[0];
}

async function post(url: string, action: string, xml: string): Promise<string> {
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
				timeout: TIMEOUT_MS,
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c) => chunks.push(c));
				res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
			},
		);
		req.on("timeout", () => {
			req.destroy(new Error(`timeout after ${TIMEOUT_MS}ms`));
		});
		req.on("error", reject);
		req.write(body);
		req.end();
	});
}

function faultOf(xml: string): string | null {
	const raw = xml.match(/<faultstring>([\s\S]*?)<\/faultstring>/i)?.[1] ?? null;
	if (!raw) return null;
	return raw
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.trim();
}

function sessionIdOf(xml: string): string | null {
	return xml.match(/<sessionid>\s*([^<\s]+)\s*<\/sessionid>/i)?.[1] ?? null;
}

function moreOf(xml: string): boolean {
	return /<more>\s*true\s*<\/more>/i.test(xml);
}

/** Count top-level `<records` nodes (not nested children). */
function recordCount(xml: string): number {
	const matches = xml.match(/<(?:\w+:)?records\b/gi);
	return matches?.length ?? 0;
}

function sampleFields(xml: string, max = 24): string[] {
	const first = xml.match(
		/<(?:\w+:)?records\b[^>]*>([\s\S]*?)<\/(?:\w+:)?records>/i,
	)?.[1];
	if (!first) return [];
	const names = new Set<string>();
	const re = /<(?:\w+:)?([A-Za-z_][\w]*)>/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(first)) !== null) {
		const name = m[1].toLowerCase();
		if (name === "records") continue;
		names.add(name);
		if (names.size >= max) break;
	}
	return [...names];
}

function tagValue(xml: string, local: string): string | null {
	const re = new RegExp(
		`<(?:\\w+:)?${local}>([\\s\\S]*?)</(?:\\w+:)?${local}>`,
		"i",
	);
	return xml.match(re)?.[1]?.trim() ?? null;
}

function classifyFault(fault: string): "not-enabled" | "query-failed" | "other" {
	const f = fault.toLowerCase();
	if (f.includes("not web service enabled") || f.includes("not enabled")) {
		return "not-enabled";
	}
	if (f.includes("query failed")) return "query-failed";
	return "other";
}

type ProbeResult = {
	entity: string;
	status:
		| "has-data"
		| "empty"
		| "not-enabled"
		| "query-failed"
		| "other-fault";
	predicate?: string;
	pageRows?: number;
	more?: boolean;
	fields?: string[];
	updateddate?: string | null;
	createddate?: string | null;
	idSample?: string | null;
	fault?: string;
};

async function probeEntity(
	url: string,
	sid: string,
	attempt: ProbeAttempt,
): Promise<ProbeResult> {
	let lastFault: string | undefined;
	let lastClass: ReturnType<typeof classifyFault> | undefined;

	for (const predicate of attempt.predicates) {
		const queryXml = await post(
			url,
			"query",
			envelope(
				`<tem:query><tem:queryString>${escapeXml(predicate)}</tem:queryString>` +
					`<tem:Entity>${escapeXml(attempt.entity)}</tem:Entity></tem:query>`,
				sid,
			),
		);
		const fault = faultOf(queryXml);
		if (fault) {
			lastFault = fault;
			lastClass = classifyFault(fault);
			// Not enabled is decisive — stop trying predicates.
			if (lastClass === "not-enabled") {
				return {
					entity: attempt.entity,
					status: "not-enabled",
					fault,
				};
			}
			// Wrong predicate → try next.
			continue;
		}

		const rows = recordCount(queryXml);
		if (rows === 0) {
			return {
				entity: attempt.entity,
				status: "empty",
				predicate,
				pageRows: 0,
				more: moreOf(queryXml),
			};
		}

		const fields = sampleFields(queryXml);
		const idGuess =
			fields.find((f) => f.endsWith("id") && !f.includes("user")) ??
			fields.find((f) => f.endsWith("id")) ??
			null;

		return {
			entity: attempt.entity,
			status: "has-data",
			predicate,
			pageRows: rows,
			more: moreOf(queryXml),
			fields,
			updateddate: tagValue(queryXml, "updateddate"),
			createddate: tagValue(queryXml, "createddate"),
			idSample: idGuess ? tagValue(queryXml, idGuess) : null,
		};
	}

	if (lastClass === "query-failed") {
		return {
			entity: attempt.entity,
			status: "query-failed",
			fault: lastFault,
		};
	}
	if (lastFault) {
		return {
			entity: attempt.entity,
			status: "other-fault",
			fault: lastFault,
		};
	}
	return {
		entity: attempt.entity,
		status: "empty",
		pageRows: 0,
	};
}

async function main() {
	if (!URL_ENV || !USER_ENV || !PASS_ENV) {
		console.error("Missing SAGE_SOAP_* env.");
		process.exit(2);
	}

	const url = URL_ENV;
	console.log("Logging on…");
	const logonXml = await post(
		url,
		"logon",
		envelope(
			`<tem:logon><tem:Username>${escapeXml(USER_ENV)}</tem:Username>` +
				`<tem:Password>${escapeXml(PASS_ENV)}</tem:Password></tem:logon>`,
		),
	);
	const fault = faultOf(logonXml);
	if (fault) throw new Error(`logon fault: ${fault}`);
	const sid = sessionIdOf(logonXml);
	if (!sid) throw new Error("logon returned no session id");

	const results: ProbeResult[] = [];
	try {
		for (const attempt of PROBES) {
			process.stdout.write(`  probe ${attempt.entity}… `);
			const result = await probeEntity(url, sid, attempt);
			results.push(result);
			const detail =
				result.status === "has-data"
					? `HAS DATA (~${result.pageRows}${result.more ? "+" : ""} on page; updated=${result.updateddate ?? "?"})`
					: result.status === "empty"
						? "empty (enabled)"
						: result.status === "not-enabled"
							? "NOT ENABLED"
							: result.status === "query-failed"
								? "query failed (wrong predicate?)"
								: `fault: ${result.fault?.slice(0, 80)}`;
			console.log(detail);
		}
	} finally {
		try {
			await post(url, "logoff", envelope(`<tem:logoff/>`, sid));
			console.log("Logged off.");
		} catch {
			// ignore
		}
	}

	console.log("\n=== SUMMARY ===\n");
	const groups: Record<string, ProbeResult[]> = {
		"has-data": [],
		empty: [],
		"not-enabled": [],
		"query-failed": [],
		"other-fault": [],
	};
	for (const r of results) groups[r.status].push(r);

	for (const [status, rows] of Object.entries(groups)) {
		if (rows.length === 0) continue;
		console.log(`## ${status} (${rows.length})`);
		for (const r of rows) {
			if (status === "has-data") {
				console.log(
					`- ${r.entity}: page=${r.pageRows}${r.more ? "+" : ""} pred=${JSON.stringify(r.predicate)} updated=${r.updateddate ?? "?"} created=${r.createddate ?? "?"} id=${r.idSample ?? "?"} fields=[${(r.fields ?? []).slice(0, 12).join(", ")}]`,
				);
			} else if (status === "empty") {
				console.log(
					`- ${r.entity}: enabled but 0 rows for ${JSON.stringify(r.predicate)}`,
				);
			} else {
				console.log(`- ${r.entity}: ${r.fault ?? ""}`);
			}
		}
		console.log("");
	}

	console.log("=== RAW JSON ===");
	console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
