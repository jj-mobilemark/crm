import { XMLParser } from "fast-xml-parser";
import type { SageEntity } from "./sage.constants";

/**
 * A single Sage record, flattened to its own scalar fields.
 *
 * Sage responses namespace every field as `typens:<field>` and, for `company`,
 * nest whole child collections (addresses, phones, emails, people). We strip the
 * prefix and keep only a record's OWN scalar fields — nested children are read
 * with their own entity query, not walked here.
 */
export type SageRecord = Record<string, string>;

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

/** Pull `Envelope.Body.queryresponse.result.records` out as an array. */
function findRecords(doc: unknown): unknown[] {
	if (!isObject(doc)) return [];
	const envelope = firstValueByLocalName(doc, "Envelope");
	const body = isObject(envelope)
		? firstValueByLocalName(envelope, "Body")
		: undefined;
	const response = isObject(body)
		? firstValueByLocalName(body, "queryresponse")
		: undefined;
	const result = isObject(response) ? response.result : undefined;
	const records = isObject(result) ? result.records : undefined;
	if (records === undefined) return [];
	return Array.isArray(records) ? records : [records];
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
