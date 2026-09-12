import { type Db, DealQuoteSource, type Prisma } from "@crm/db";

/** Canonical warehouse / CRM quote id: `QYYMMDD-###` (11 chars). */
export const QUOTE_NUMBER_RE = /^Q[0-9]{6}-[0-9]{3}$/;

const CANONICAL = /#?Q(\d{6})-(\d{3})\b/gi;
const SHORTHAND = /#?Q(\d{6})-(\d{3})((?:\s*,\s*\d{1,3})+)/gi;
const QUOTING_TOOL = /created in quoting tool/i;

const NOTE_FIELD_KEYS = new Set([
	"note",
	"notes",
	"details",
	"opportunitynote",
	"opponote",
	"opportunity_note",
	"oppo_note",
]);

export type ParsedDealQuote = {
	quoteNumber: string;
	source: DealQuoteSource;
};

export type DealQuoteDto = {
	quoteNumber: string;
	isPrimary: boolean;
	source: DealQuoteSource;
};

/**
 * Upper/trim one value. Returns the canonical id or null.
 *
 * Does not expand shorthand. Use {@link expandQuoteNumbers} for paste/Sage text.
 */
export function canonicalizeQuoteNumber(
	value: string | null | undefined,
): string | null {
	const next = value?.trim().toUpperCase() ?? "";
	return QUOTE_NUMBER_RE.test(next) ? next : null;
}

/**
 * Pull every canonical `QYYMMDD-###` out of free text.
 *
 * Expands Sage name shorthand (`#Q260622-003,4,5,6,7`) into five full ids.
 * Does not invent from junk (`Q260702`, `#Q260908-002/013`, `& 002`).
 */
export function expandQuoteNumbers(text: string | null | undefined): string[] {
	if (!text) return [];

	const seen = new Set<string>();
	const out: string[] = [];
	const add = (quoteNumber: string) => {
		if (seen.has(quoteNumber)) return;
		seen.add(quoteNumber);
		out.push(quoteNumber);
	};

	const remainder = text.replace(
		SHORTHAND,
		(_all, yymmdd: string, first: string, tail: string) => {
			add(`Q${yymmdd}-${first}`);
			for (const part of tail.split(",")) {
				const digits = part.trim();
				if (!digits) continue;
				add(`Q${yymmdd}-${digits.padStart(3, "0")}`);
			}
			return " ";
		},
	);

	for (const match of remainder.matchAll(CANONICAL)) {
		add(`Q${match[1]}-${match[2]}`);
	}

	return out;
}

function stringField(
	record: Record<string, unknown>,
	key: string,
): string | null {
	const value = record[key];
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function noteTexts(record: Record<string, unknown>): string[] {
	const out: string[] = [];
	for (const [key, value] of Object.entries(record)) {
		if (!NOTE_FIELD_KEYS.has(key.toLowerCase())) continue;
		if (typeof value !== "string") continue;
		const trimmed = value.trim();
		if (trimmed) out.push(trimmed);
	}
	return out;
}

/**
 * Quote ids on a Sage opportunity record.
 *
 * Note-like fields (and the quoting-tool stamp) win over `description`.
 * A number in both is stored once, source `SAGE_NOTE`.
 */
export function quotesFromSageRecord(
	record: Record<string, unknown>,
): ParsedDealQuote[] {
	const description = stringField(record, "description") ?? "";
	const fromNote = expandQuoteNumbers(noteTexts(record).join("\n"));
	const fromDesc = expandQuoteNumbers(description);
	const quotingInDesc = QUOTING_TOOL.test(description);

	const seen = new Set<string>();
	const out: ParsedDealQuote[] = [];

	for (const quoteNumber of fromNote) {
		seen.add(quoteNumber);
		out.push({ quoteNumber, source: DealQuoteSource.SAGE_NOTE });
	}
	for (const quoteNumber of fromDesc) {
		if (seen.has(quoteNumber)) continue;
		seen.add(quoteNumber);
		out.push({
			quoteNumber,
			source: quotingInDesc
				? DealQuoteSource.SAGE_NOTE
				: DealQuoteSource.SAGE_DESCRIPTION,
		});
	}

	return out;
}

export function quotesFromText(
	text: string,
	source: DealQuoteSource,
): ParsedDealQuote[] {
	return expandQuoteNumbers(text).map((quoteNumber) => ({
		quoteNumber,
		source,
	}));
}

const QUOTE_ORDER = [
	{ isPrimary: "desc" as const },
	{ createdAt: "asc" as const },
];

export function toDealQuoteDto(row: {
	quoteNumber: string;
	isPrimary: boolean;
	source: DealQuoteSource;
}): DealQuoteDto {
	return {
		quoteNumber: row.quoteNumber,
		isPrimary: row.isPrimary,
		source: row.source,
	};
}

export async function listDealQuotes(
	db: Db,
	dealId: string,
): Promise<DealQuoteDto[]> {
	const rows = await db.dealQuote.findMany({
		where: { dealId },
		orderBy: QUOTE_ORDER,
		select: { quoteNumber: true, isPrimary: true, source: true },
	});
	return rows.map(toDealQuoteDto);
}

/**
 * Add missing quote numbers. Never deletes. Never overwrites source.
 * The first new row becomes primary only when the deal has none.
 */
export async function attachDealQuotes(
	db: Db,
	dealId: string,
	quotes: readonly ParsedDealQuote[],
): Promise<number> {
	if (quotes.length === 0) return 0;

	const existing = await db.dealQuote.findMany({
		where: { dealId },
		select: { quoteNumber: true, isPrimary: true },
	});
	const have = new Set(existing.map((row) => row.quoteNumber));
	const toCreate = quotes.filter((row) => !have.has(row.quoteNumber));
	if (toCreate.length === 0) return 0;

	const hasPrimary = existing.some((row) => row.isPrimary);
	const data: Prisma.DealQuoteCreateManyInput[] = toCreate.map(
		(row, index) => ({
			dealId,
			quoteNumber: row.quoteNumber,
			source: row.source,
			isPrimary: !hasPrimary && index === 0,
		}),
	);

	const result = await db.dealQuote.createMany({
		data,
		skipDuplicates: true,
	});
	return result.count;
}
