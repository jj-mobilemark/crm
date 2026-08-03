import { XMLParser } from "fast-xml-parser";
import type { SageEntity } from "./sage.constants";

/**
 * A single Sage record, flattened to its own scalar fields.
 *
 * Sage responses namespace every field as `typens:<field>` and, for `company`,
 * nest whole child collections (addresses, phones, emails, people). Flat
 * `parseRecords` keeps only a record's OWN scalar fields; `parseCompanyTrees`
 * walks the nested children for the company backfill.
 */
export type SageRecord = Record<string, string>;

/**
 * One company plus the nested children Sage returns under it.
 *
 * Association is by XML nesting, not an FK on the person. Address / email /
 * phone are typically one primary each; people is the full list.
 */
export type SageCompanyTree = {
	company: SageRecord;
	people: SageRecord[];
	address: SageRecord | null;
	email: SageRecord | null;
	phone: SageRecord | null;
};

/** A page of query/next results, including Sage's `<more>` flag. */
export type SageQueryPage = {
	records: SageRecord[];
	more: boolean;
};

/** A page of hierarchical company results. */
export type SageCompanyPage = {
	companies: SageCompanyTree[];
	more: boolean;
};

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	// Everything Sage returns is text; keep ids like "0000777" as strings and
	// never let the parser coerce "00" to a number and drop the leading zero.
	parseTagValue: false,
	parseAttributeValue: false,
	trimValues: true,
});

/** The SOAP fault string, or null when the response is not a fault. */
export function parseFault(xml: string): string | null {
	const captured = xml.match(/<faultstring>([\s\S]*?)<\/faultstring>/i)?.[1];
	return captured !== undefined ? decodeEntities(captured.trim()) : null;
}

/** The session id from a `logon` response, or null. */
export function parseSessionId(xml: string): string | null {
	return xml.match(/<sessionid>\s*([^<\s]+)\s*<\/sessionid>/i)?.[1] ?? null;
}

/**
 * Every top-level record of the given entity from a `queryresponse`.
 *
 * Only the record's own scalar fields are returned; nested child records (which
 * appear inside a `company` response) are dropped. Field keys have the
 * `typens:` prefix stripped and are lower-cased as Sage returns them.
 */
export function parseRecords(xml: string, entity: SageEntity): SageRecord[] {
	const doc = parser.parse(xml) as unknown;
	const records = findRecords(doc);
	const wanted = `typens:${entity}`;

	const out: SageRecord[] = [];
	for (const raw of records) {
		if (!isObject(raw)) continue;
		if (raw["@_xsi:type"] !== wanted) continue;
		out.push(scalarFields(raw));
	}
	return out;
}

/**
 * Hierarchical company parse: each company plus nested people / address /
 * email / phone children.
 *
 * Used by the company backfill. Flat `parseRecords` remains for opportunity
 * and single-record reads that do not need children.
 */
export function parseCompanyTrees(xml: string): SageCompanyTree[] {
	const doc = parser.parse(xml) as unknown;
	const records = findRecords(doc);
	const out: SageCompanyTree[] = [];

	for (const raw of records) {
		if (!isObject(raw)) continue;
		if (raw["@_xsi:type"] !== "typens:company") continue;
		out.push(companyTreeFrom(raw));
	}
	return out;
}

/** Whether Sage has another page (`<more>true</more>`). */
export function parseMore(xml: string): boolean {
	const doc = parser.parse(xml) as unknown;
	const result = findResult(doc);
	if (!isObject(result)) return false;
	const more = firstValueByLocalName(result, "more");
	if (typeof more === "string") return more.trim().toLowerCase() === "true";
	if (typeof more === "boolean") return more;
	return false;
}

/** Flat records + the `<more>` flag from one query/next response. */
export function parseQueryPage(
	xml: string,
	entity: SageEntity,
): SageQueryPage {
	return { records: parseRecords(xml, entity), more: parseMore(xml) };
}

/** Hierarchical companies + the `<more>` flag. */
export function parseCompanyPage(xml: string): SageCompanyPage {
	return { companies: parseCompanyTrees(xml), more: parseMore(xml) };
}

function companyTreeFrom(raw: Record<string, unknown>): SageCompanyTree {
	const people: SageRecord[] = [];
	let address: SageRecord | null = null;
	let email: SageRecord | null = null;
	let phone: SageRecord | null = null;

	// Direct children only — do NOT recurse into person nodes, or their nested
	// emails get stolen as the company's email and the people lose theirs.
	for (const child of collectDirectTypedRecords(raw)) {
		const type = child["@_xsi:type"];
		if (type === "typens:person") {
			people.push(enrichPerson(child));
		} else if (type === "typens:address" && !address) {
			address = scalarFields(child);
		} else if (type === "typens:email" && !email) {
			email = scalarFields(child);
		} else if (type === "typens:phone" && !phone) {
			phone = scalarFields(child);
		}
	}

	return {
		company: scalarFields(raw),
		people,
		address,
		email,
		phone,
	};
}

/** Person scalars plus nested email/phone (Sage nests those under the person). */
function enrichPerson(raw: Record<string, unknown>): SageRecord {
	const fields = scalarFields(raw);
	for (const child of collectDirectTypedRecords(raw)) {
		const type = child["@_xsi:type"];
		if (type === "typens:email" && !fields.emailaddress) {
			const nested = scalarFields(child);
			if (nested.emailaddress) fields.emailaddress = nested.emailaddress;
		} else if (type === "typens:phone" && !fields.number) {
			const nested = scalarFields(child);
			if (nested.areacode) fields.areacode = nested.areacode;
			if (nested.number) fields.number = nested.number;
		}
	}
	return fields;
}

/**
 * Typed `records` that are direct children of `node`, or one level under a
 * named wrapper (`people` / `address` / …). Does not descend into typed
 * children — that would pull a person's email up to the company.
 */
function collectDirectTypedRecords(
	node: Record<string, unknown>,
): Record<string, unknown>[] {
	const out: Record<string, unknown>[] = [];

	for (const [key, value] of Object.entries(node)) {
		if (key.startsWith("@_")) continue;
		if (value === null || value === undefined) continue;
		if (typeof value !== "object") continue;

		const items = Array.isArray(value) ? value : [value];
		for (const item of items) {
			if (!isObject(item)) continue;
			if (typeof item["@_xsi:type"] === "string") {
				out.push(item);
				continue;
			}
			// Named wrapper — take typed records one level down only.
			for (const [innerKey, innerValue] of Object.entries(item)) {
				if (innerKey.startsWith("@_")) continue;
				if (innerValue === null || typeof innerValue !== "object") continue;
				const nested = Array.isArray(innerValue) ? innerValue : [innerValue];
				for (const child of nested) {
					if (isObject(child) && typeof child["@_xsi:type"] === "string") {
						out.push(child);
					}
				}
			}
		}
	}

	return out;
}

/** Pull `Envelope.Body.queryresponse.result.records` out as an array. */
function findRecords(doc: unknown): unknown[] {
	const result = findResult(doc);
	const records = isObject(result) ? result.records : undefined;
	if (records === undefined) return [];
	return Array.isArray(records) ? records : [records];
}

function findResult(doc: unknown): unknown {
	if (!isObject(doc)) return undefined;
	const envelope = firstValueByLocalName(doc, "Envelope");
	const body = isObject(envelope)
		? firstValueByLocalName(envelope, "Body")
		: undefined;
	const response = isObject(body)
		? (firstValueByLocalName(body, "queryresponse") ??
			firstValueByLocalName(body, "nextresponse"))
		: undefined;
	return isObject(response) ? response.result : undefined;
}

/** A record's own scalar (string) fields, with the `typens:` prefix removed. */
function scalarFields(record: Record<string, unknown>): SageRecord {
	const fields: SageRecord = {};
	for (const [key, value] of Object.entries(record)) {
		if (key.startsWith("@_")) continue;
		const name = stripPrefix(key);
		if (typeof value === "string") {
			fields[name] = value;
		} else if (typeof value === "number" || typeof value === "boolean") {
			fields[name] = String(value);
		}
		// Objects/arrays are nested child collections — skip them.
	}
	return fields;
}

function firstValueByLocalName(
	obj: Record<string, unknown>,
	local: string,
): unknown {
	for (const [key, value] of Object.entries(obj)) {
		if (stripPrefix(key) === local) return value;
	}
	return undefined;
}

function stripPrefix(key: string): string {
	const colon = key.indexOf(":");
	return colon === -1 ? key : key.slice(colon + 1);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeEntities(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&");
}
