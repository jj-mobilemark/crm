/**
 * Read-only: local deal + Sage SOAP snapshot for one opportunity id.
 *
 *   bun run scripts/sage-check-opp.ts 799
 */
import "@crm/env/load";
import { db } from "@crm/db";

const URL_ENV = process.env.SAGE_SOAP_URL;
const USER_ENV = process.env.SAGE_SOAP_USER;
const PASS_ENV = process.env.SAGE_SOAP_PASSWORD;
const REQUEST_NS = "http://tempuri.org/";
const TYPE_NS = "http://tempuri.org/type";
const TIMEOUT_MS = 40_000;

const FIELDS = [
	"opportunityid",
	"description",
	"forecast",
	"total",
	"certainty",
	"stage",
	"status",
	"type",
	"targetclose",
	"updateddate",
	"assigneduserid",
	"primarycompanyid",
] as const;

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

async function post(url: string, action: string, xml: string): Promise<string> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: {
				"content-type": "text/xml; charset=utf-8",
				soapaction: `"${REQUEST_NS}${action}"`,
			},
			body: xml,
			signal: controller.signal,
		});
		return await res.text();
	} finally {
		clearTimeout(timeout);
	}
}

function faultOf(xml: string): string | null {
	return xml.match(/<faultstring>([\s\S]*?)<\/faultstring>/i)?.[1] ?? null;
}

function sessionIdOf(xml: string): string | null {
	return xml.match(/<sessionid>\s*([^<\s]+)\s*<\/sessionid>/i)?.[1] ?? null;
}

function tagValue(xml: string, local: string): string | null {
	const re = new RegExp(
		`<(?:\\w+:)?${local}>([\\s\\S]*?)</(?:\\w+:)?${local}>`,
		"i",
	);
	return xml.match(re)?.[1]?.trim() ?? null;
}

async function main() {
	const oppId = process.argv[2] ?? "799";

	try {
		const deal = await db.deal.findFirst({
			where: { sageCrmOpportunityId: oppId },
			select: {
				id: true,
				name: true,
				amount: true,
				weightedAmount: true,
				probability: true,
				stage: true,
				sageStage: true,
				sageStatus: true,
				dealType: true,
				currency: true,
				expectedCloseDate: true,
				owner: { select: { name: true, email: true } },
				sagePushedAt: true,
				sageUpdatedAt: true,
				updatedAt: true,
				fieldChanges: {
					orderBy: { createdAt: "desc" },
					take: 20,
					select: {
						field: true,
						fromValue: true,
						toValue: true,
						source: true,
						createdAt: true,
						actor: { select: { name: true, email: true } },
					},
				},
			},
		});

		const outbox = deal
			? await db.sageOutbox.findMany({
					where: { entity: "deal", localId: deal.id },
					orderBy: { updatedAt: "desc" },
					take: 10,
				})
			: [];

		console.log("=== LOCAL ===");
		console.log(JSON.stringify({ deal, outbox }, null, 2));
	} catch (err) {
		console.log("=== LOCAL ===");
		console.log(
			`(skipped — DB unavailable: ${err instanceof Error ? err.message.split("\n")[0] : String(err)})`,
		);
	} finally {
		await db.$disconnect().catch(() => {});
	}

	if (!URL_ENV || !USER_ENV || !PASS_ENV) {
		console.error("Missing SAGE_SOAP_* — skipping live Sage query.");
		process.exit(2);
	}

	const url = URL_ENV;
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

	try {
		const predicate = `oppo_opportunityid = ${oppId}`;
		const queryXml = await post(
			url,
			"query",
			envelope(
				`<tem:query><tem:queryString>${escapeXml(predicate)}</tem:queryString>` +
					`<tem:Entity>opportunity</tem:Entity></tem:query>`,
				sid,
			),
		);
		const qFault = faultOf(queryXml);
		if (qFault) throw new Error(`query fault: ${qFault}`);

		const sage: Record<string, string | null> = {};
		for (const field of FIELDS) {
			sage[field] = tagValue(queryXml, field);
		}

		console.log("=== SAGE (live SOAP) ===");
		console.log(JSON.stringify(sage, null, 2));
	} finally {
		try {
			await post(url, "logoff", envelope(`<tem:logoff/>`, sid));
		} catch {
			// ignore
		}
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
