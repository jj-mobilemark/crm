/**
 * Phase 0 probe: discover Sage CRM SOAP write (add / update) envelope shape.
 *
 * Standalone diagnostic — hits LIVE Sage. Safe by design: it uses the real
 * service-account credentials (only a BAD logon can lock the account; SOAP
 * faults from a wrong body do not), holds ONE session, and always logs off.
 *
 *   bun run scripts/sage-push-probe.ts --logon-only   # reachability + creds
 *   bun run scripts/sage-push-probe.ts --update        # try UPDATE on opp 557 (restores it)
 *   bun run scripts/sage-push-probe.ts --add           # ADD a tiny throwaway oppo on company 24
 *
 * The password is never printed. Raw SOAP responses ARE printed so the correct
 * shape can be read off; opp 557's `description` is captured and restored after
 * the update test. The --add oppo is left in Sage (tiny forecast) for manual
 * deletion — its new id is logged.
 */
import "@crm/env/load";

const URL_ENV = process.env.SAGE_SOAP_URL;
const USER_ENV = process.env.SAGE_SOAP_USER;
const PASS_ENV = process.env.SAGE_SOAP_PASSWORD;

const REQUEST_NS = "http://tempuri.org/";
const TYPE_NS = "http://tempuri.org/type";
const TIMEOUT_MS = 40_000;

/** Opp 557 "Jordan Test Push From Sales Tool"; company 24 MOBILE MARK INC. */
const TEST_OPPORTUNITY_ID = "557";
const TEST_COMPANY_ID = "24";

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
		const text = await res.text();
		if (!res.ok) return `HTTP ${res.status}\n${text}`;
		return text;
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

/** First value of a tag by local name (ignores namespace prefix). */
function tagValue(xml: string, local: string): string | null {
	const re = new RegExp(`<(?:\\w+:)?${local}>([\\s\\S]*?)</(?:\\w+:)?${local}>`, "i");
	return xml.match(re)?.[1]?.trim() ?? null;
}

async function logon(url: string): Promise<string> {
	const body =
		`<tem:logon><tem:Username>${escapeXml(USER_ENV ?? "")}</tem:Username>` +
		`<tem:Password>${escapeXml(PASS_ENV ?? "")}</tem:Password></tem:logon>`;
	const xml = await post(url, "logon", envelope(body));
	const fault = faultOf(xml);
	if (fault) throw new Error(`logon fault: ${fault}`);
	const sid = sessionIdOf(xml);
	if (!sid) throw new Error(`logon returned no session id:\n${xml}`);
	return sid;
}

async function logoff(url: string, sid: string): Promise<void> {
	try {
		await post(url, "logoff", envelope(`<tem:logoff/>`, sid));
	} catch {
		// dangling session is harmless
	}
}

async function query(
	url: string,
	sid: string,
	entity: string,
	predicate: string,
): Promise<string> {
	const body =
		`<tem:query><tem:queryString>${escapeXml(predicate)}</tem:queryString>` +
		`<tem:Entity>${escapeXml(entity)}</tem:Entity></tem:query>`;
	return post(url, "query", envelope(body, sid));
}

/** Build an update body variant. `fields` are {name,value} in short Sage names. */
function updateBody(
	variant: "A" | "B" | "C",
	entity: string,
	fields: { name: string; value: string }[],
): string {
	const prefixed = (name: string, value: string) =>
		`<typens:${name}>${escapeXml(value)}</typens:${name}>`;
	const bare = (name: string, value: string) =>
		`<${name}>${escapeXml(value)}</${name}>`;

	if (variant === "A") {
		// tem: operation + entityname, typens: typed record + prefixed children
		const inner = fields.map((f) => prefixed(f.name, f.value)).join("");
		return (
			`<tem:update><tem:entityname>${entity}</tem:entityname>` +
			`<tem:records xsi:type="typens:${entity}">${inner}</tem:records></tem:update>`
		);
	}
	if (variant === "B") {
		// tem: operation + entityname, typed record with BARE children
		const inner = fields.map((f) => bare(f.name, f.value)).join("");
		return (
			`<tem:update><tem:entityname>${entity}</tem:entityname>` +
			`<tem:records xsi:type="typens:${entity}">${inner}</tem:records></tem:update>`
		);
	}
	// C: operation defaulted to the TYPE namespace, bare children (StackOverflow shape)
	const inner = fields.map((f) => bare(f.name, f.value)).join("");
	return (
		`<update xmlns="${TYPE_NS}"><entityname>${entity}</entityname>` +
		`<records xsi:type="${entity}">${inner}</records></update>`
	);
}

function addBody(
	variant: "A" | "B" | "C",
	entity: string,
	fields: { name: string; value: string }[],
): string {
	// Same shapes as update, different operation tag.
	return updateBody(variant, entity, fields).replace(/update/g, "add");
}

async function main(): Promise<void> {
	if (!URL_ENV || !USER_ENV || !PASS_ENV) {
		console.error(
			"SAGE_SOAP_URL / SAGE_SOAP_USER / SAGE_SOAP_PASSWORD must all be set.",
		);
		process.exit(2);
	}
	const url = URL_ENV;
	const argv = process.argv.slice(2);
	const mode = argv.includes("--add")
		? "add"
		: argv.includes("--update")
			? "update"
			: "logon-only";

	console.log(`[probe] mode=${mode} url-host=${new URL(url).host}`);

	const sid = await logon(url);
	console.log(`[probe] logon OK (session length=${sid.length})`);

	try {
		if (mode === "logon-only") {
			// Prove a read works too, so we know the session is usable.
			const xml = await query(
				url,
				sid,
				"opportunity",
				`oppo_opportunityid = ${TEST_OPPORTUNITY_ID}`,
			);
			console.log(
				`[probe] query opp ${TEST_OPPORTUNITY_ID}: description=`,
				tagValue(xml, "description"),
			);
			return;
		}

		if (mode === "update") {
			const before = await query(
				url,
				sid,
				"opportunity",
				`oppo_opportunityid = ${TEST_OPPORTUNITY_ID}`,
			);
			const original = tagValue(before, "description") ?? "";
			console.log(`[probe] original description=${JSON.stringify(original)}`);

			for (const variant of ["A", "B", "C"] as const) {
				const marker = `PUSH PROBE ${variant} ${new Date().toISOString()}`;
				const body = updateBody(variant, "opportunity", [
					{ name: "opportunityid", value: TEST_OPPORTUNITY_ID },
					{ name: "description", value: marker },
				]);
				const res = await post(url, "update", envelope(body, sid));
				const fault = faultOf(res);
				console.log(
					`\n[probe] UPDATE variant ${variant}: ${fault ? `FAULT: ${fault}` : "no fault"}`,
				);
				console.log(res.slice(0, 1200));
				if (!fault) {
					const check = await query(
						url,
						sid,
						"opportunity",
						`oppo_opportunityid = ${TEST_OPPORTUNITY_ID}`,
					);
					const now = tagValue(check, "description");
					console.log(
						`[probe] read-back description=${JSON.stringify(now)} (marker applied: ${now === marker})`,
					);
					if (now === marker) {
						console.log(`[probe] >>> WORKING UPDATE VARIANT: ${variant}`);
						break;
					}
				}
			}

			// Restore whatever the original description was.
			const restore = updateBody("A", "opportunity", [
				{ name: "opportunityid", value: TEST_OPPORTUNITY_ID },
				{ name: "description", value: original },
			]);
			await post(url, "update", envelope(restore, sid));
			console.log(`[probe] restore attempted (variant A).`);
			return;
		}

		// mode === "add"
		for (const variant of ["A", "B", "C"] as const) {
			const marker = `PUSH PROBE ADD ${variant} ${new Date().toISOString()}`;
			const body = addBody(variant, "opportunity", [
				{ name: "primarycompanyid", value: TEST_COMPANY_ID },
				{ name: "description", value: marker },
				{ name: "forecast", value: "1" },
				{ name: "certainty", value: "0" },
				{ name: "stage", value: "Lead" },
				{ name: "status", value: "In Progress" },
			]);
			const res = await post(url, "add", envelope(body, sid));
			const fault = faultOf(res);
			console.log(
				`\n[probe] ADD variant ${variant}: ${fault ? `FAULT: ${fault}` : "no fault"}`,
			);
			console.log(res.slice(0, 1500));
			if (!fault) {
				// Sage returns the new id as <crmid>, not <opportunityid>.
				const newId =
					tagValue(res, "crmid") ??
					tagValue(res, "opportunityid") ??
					tagValue(res, "id");
				console.log(`[probe] >>> WORKING ADD VARIANT: ${variant}; new id=${newId}`);
				console.log(
					`[probe] DELETE THIS TEST OPPORTUNITY IN SAGE: id=${newId} on company ${TEST_COMPANY_ID}`,
				);
				break;
			}
		}
	} finally {
		await logoff(url, sid);
		console.log(`[probe] logoff done.`);
	}
}

void main().catch((error: unknown) => {
	console.error(
		"[probe] crashed:",
		error instanceof Error ? error.message : String(error),
	);
	process.exit(1);
});
