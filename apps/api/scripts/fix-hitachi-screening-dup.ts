/**
 * One-shot: reassign Teresa Whitacre from the Screening domain orphan
 * (`hitachirail-cd.com`) to Sage-backed Hitachi Rail, then delete the orphan.
 *
 * Resolve by email + company name (IDs differ across envs).
 *
 *   bun run scripts/fix-hitachi-screening-dup.ts
 *   bun run scripts/fix-hitachi-screening-dup.ts --dry-run
 *   bun run scripts/fix-hitachi-screening-dup.ts --sage-probe
 *   bun run scripts/fix-hitachi-screening-dup.ts --sage-reparent  # only if probe finds junk
 *
 * Prod: point DATABASE_URL at Railway Postgres (or swap env) and re-run.
 */
import "@crm/env/load";
import { db } from "@crm/db";

const EMAIL = "twhitacre@hitachirail-cd.com";
const ORPHAN_DOMAIN = "hitachirail-cd.com";
const HITACHI_NAME = "Hitachi Rail";
const EXPECTED_HITACHI_CONTACTS = 5;

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const sageProbe = args.has("--sage-probe") || args.has("--sage-reparent");
const sageReparent = args.has("--sage-reparent");

const URL_ENV = process.env.SAGE_SOAP_URL;
const USER_ENV = process.env.SAGE_SOAP_USER;
const PASS_ENV = process.env.SAGE_SOAP_PASSWORD;
const REQUEST_NS = "http://tempuri.org/";
const TYPE_NS = "http://tempuri.org/type";
const TIMEOUT_MS = 40_000;

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

function allTagValues(xml: string, local: string): string[] {
	const re = new RegExp(
		`<(?:\\w+:)?${local}>([\\s\\S]*?)</(?:\\w+:)?${local}>`,
		"gi",
	);
	const out: string[] = [];
	for (const match of xml.matchAll(re)) {
		const v = match[1]?.trim();
		if (v) out.push(v);
	}
	return out;
}

async function sageLogon(url: string): Promise<string> {
	const body =
		`<tem:logon><tem:Username>${escapeXml(USER_ENV ?? "")}</tem:Username>` +
		`<tem:Password>${escapeXml(PASS_ENV ?? "")}</tem:Password></tem:logon>`;
	const xml = await post(url, "logon", envelope(body));
	const fault = faultOf(xml);
	if (fault) throw new Error(`logon fault: ${fault}`);
	const sid = sessionIdOf(xml);
	if (!sid) throw new Error(`logon returned no session id`);
	return sid;
}

async function sageLogoff(url: string, sid: string): Promise<void> {
	await post(url, "logoff", envelope("<tem:logoff/>", sid));
}

async function sageQuery(
	url: string,
	sid: string,
	entity: string,
	queryString: string,
): Promise<string> {
	const body =
		`<tem:query><tem:queryString>${escapeXml(queryString)}</tem:queryString>` +
		`<tem:Entity>${escapeXml(entity)}</tem:Entity></tem:query>`;
	const xml = await post(url, "query", envelope(body, sid));
	const fault = faultOf(xml);
	if (fault) throw new Error(`query fault (${entity}): ${fault}`);
	return xml;
}

async function runSageProbe(hitachiSageId: string | null) {
	if (!URL_ENV || !USER_ENV || !PASS_ENV) {
		console.log("Sage probe skipped — SAGE_SOAP_* not set.");
		return;
	}

	console.log("\n--- Sage SOAP probe ---");
	const sid = await sageLogon(URL_ENV);
	try {
		// Person email is nested under email records — query by last name.
		const personXml = await sageQuery(
			URL_ENV,
			sid,
			"person",
			`pers_lastname like 'Whitacre%'`,
		);
		const personIds = allTagValues(personXml, "personid");
		const companyIds = allTagValues(personXml, "companyid");
		const firstNames = allTagValues(personXml, "firstname");
		const lastNames = allTagValues(personXml, "lastname");
		console.log(`Person lastname Whitacre: ${personIds.length} row(s)`, {
			people: personIds.map((id, i) => ({
				personId: id,
				companyId: companyIds[i] ?? null,
				name: [firstNames[i], lastNames[i]].filter(Boolean).join(" "),
			})),
		});

		const companyXml = await sageQuery(
			URL_ENV,
			sid,
			"company",
			`comp_website like '%${ORPHAN_DOMAIN}%' OR comp_name like '%hitachirail-cd%'`,
		);
		const junkCompanyIds = allTagValues(companyXml, "companyid");
		const junkNames = allTagValues(companyXml, "name");
		console.log(`Company by website/name junk: ${junkCompanyIds.length}`, {
			junkCompanyIds,
			junkNames,
		});

		if (personIds.length === 0 && junkCompanyIds.length === 0) {
			console.log(
				"Sage is clean — Teresa/domain orphan not present (local-only Screening create).",
			);
			return;
		}

		if (!sageReparent) {
			console.log(
				"Re-run with --sage-reparent to move Whitacre person(s) under Hitachi Rail.",
			);
			return;
		}

		if (!hitachiSageId) {
			throw new Error(
				"Cannot reparent in Sage — local Hitachi Rail has no sageCrmCompanyId.",
			);
		}

		for (const personId of personIds) {
			const idx = personIds.indexOf(personId);
			const currentCompany = companyIds[idx] ?? null;
			if (currentCompany === hitachiSageId) {
				console.log(`Person ${personId} already under Hitachi Rail.`);
				continue;
			}
			if (dryRun) {
				console.log(
					`[dry-run] Would update person ${personId} companyid → ${hitachiSageId}`,
				);
				continue;
			}
			const updateBody =
				`<tem:update><tem:entityname>person</tem:entityname>` +
				`<tem:records xsi:type="typens:person">` +
				`<typens:personid>${escapeXml(personId)}</typens:personid>` +
				`<typens:companyid>${escapeXml(hitachiSageId)}</typens:companyid>` +
				`</tem:records></tem:update>`;
			const updateXml = await post(
				URL_ENV,
				"update",
				envelope(updateBody, sid),
			);
			const fault = faultOf(updateXml);
			if (fault) throw new Error(`person update fault: ${fault}`);
			console.log(`Updated person ${personId} → company ${hitachiSageId}`);
		}

		// Only delete junk Sage companies with no remaining people.
		for (const junkId of junkCompanyIds) {
			if (junkId === hitachiSageId) continue;
			const peopleXml = await sageQuery(
				URL_ENV,
				sid,
				"person",
				`pers_companyid = ${junkId}`,
			);
			const remaining = allTagValues(peopleXml, "personid");
			if (remaining.length > 0) {
				console.log(
					`Skip delete Sage company ${junkId} — still has ${remaining.length} person(s).`,
				);
				continue;
			}
			console.log(
				`Junk Sage company ${junkId} has 0 people — manual delete in Sage UI if desired (script does not delete companies).`,
			);
		}
	} finally {
		await sageLogoff(URL_ENV, sid);
	}
}

async function main() {
	console.log(
		dryRun ? "DRY RUN — no writes" : "LIVE — will update/delete local rows",
	);

	const contact = await db.contact.findFirst({
		where: { email: { equals: EMAIL, mode: "insensitive" } },
		select: {
			id: true,
			email: true,
			firstName: true,
			lastName: true,
			companyId: true,
			company: {
				select: {
					id: true,
					name: true,
					domain: true,
					sageCrmCompanyId: true,
					primaryContactId: true,
					_count: { select: { contacts: true, deals: true } },
				},
			},
		},
	});

	if (!contact) {
		console.log(`No contact with email ${EMAIL} — nothing to fix.`);
	} else {
		console.log("Contact:", {
			id: contact.id,
			email: contact.email,
			name: [contact.firstName, contact.lastName].filter(Boolean).join(" "),
			company: contact.company
				? {
						id: contact.company.id,
						name: contact.company.name,
						domain: contact.company.domain,
					}
				: null,
		});
	}

	const hitachi = await db.company.findFirst({
		where: {
			name: { equals: HITACHI_NAME, mode: "insensitive" },
			sageCrmCompanyId: { not: null },
		},
		select: {
			id: true,
			name: true,
			domain: true,
			sageCrmCompanyId: true,
			_count: { select: { contacts: true } },
		},
		orderBy: { createdAt: "asc" },
	});

	if (!hitachi) {
		throw new Error(
			`No Sage-backed company named "${HITACHI_NAME}" — aborting.`,
		);
	}

	console.log("Hitachi Rail:", {
		id: hitachi.id,
		domain: hitachi.domain,
		sageCrmCompanyId: hitachi.sageCrmCompanyId,
		contactCount: hitachi._count.contacts,
	});

	if (hitachi._count.contacts < EXPECTED_HITACHI_CONTACTS) {
		console.warn(
			`Warning: expected ~${EXPECTED_HITACHI_CONTACTS} contacts on Hitachi Rail, found ${hitachi._count.contacts}.`,
		);
	}

	const targetOrphan = await db.company.findFirst({
		where: {
			OR: [{ domain: ORPHAN_DOMAIN }, { name: ORPHAN_DOMAIN }],
			id: { not: hitachi.id },
		},
		select: {
			id: true,
			name: true,
			domain: true,
			primaryContactId: true,
			sageCrmCompanyId: true,
			_count: { select: { contacts: true, deals: true } },
		},
	});

	if (contact && contact.companyId === hitachi.id) {
		console.log("Contact already on Hitachi Rail.");
	} else if (contact) {
		if (dryRun) {
			console.log(
				`[dry-run] Would set contact ${contact.id} companyId → ${hitachi.id}`,
			);
		} else {
			await db.contact.update({
				where: { id: contact.id },
				data: { companyId: hitachi.id },
			});
			console.log(`Updated contact ${contact.id} → Hitachi Rail ${hitachi.id}`);
		}
	}

	if (!targetOrphan) {
		console.log("No orphan company to delete.");
	} else if (targetOrphan.id === hitachi.id) {
		console.log("Orphan resolved to Hitachi Rail — not deleting.");
	} else {
		console.log("Orphan company:", {
			id: targetOrphan.id,
			name: targetOrphan.name,
			domain: targetOrphan.domain,
			contacts: targetOrphan._count.contacts,
			deals: targetOrphan._count.deals,
			primaryContactId: targetOrphan.primaryContactId,
		});

		if (targetOrphan.primaryContactId) {
			if (dryRun) {
				console.log("[dry-run] Would clear primaryContactId on orphan");
			} else {
				await db.company.update({
					where: { id: targetOrphan.id },
					data: { primaryContactId: null },
				});
				console.log("Cleared primaryContactId on orphan");
			}
		}

		const remainingContacts = await db.contact.count({
			where: {
				companyId: targetOrphan.id,
				...(contact ? { id: { not: contact.id } } : {}),
			},
		});
		const remainingDeals = await db.deal.count({
			where: { companyId: targetOrphan.id },
		});

		if (remainingContacts > 0 || remainingDeals > 0) {
			throw new Error(
				`Orphan still has contacts=${remainingContacts} deals=${remainingDeals} — not deleting.`,
			);
		}

		if (dryRun) {
			console.log(`[dry-run] Would DELETE company ${targetOrphan.id}`);
		} else {
			await db.company.delete({ where: { id: targetOrphan.id } });
			console.log(`Deleted orphan company ${targetOrphan.id}`);
		}
	}

	if (sageProbe) {
		await runSageProbe(hitachi.sageCrmCompanyId);
	} else {
		console.log(
			"\nSkipped Sage probe (pass --sage-probe). Local cleanup done.",
		);
	}
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await db.$disconnect();
	});
