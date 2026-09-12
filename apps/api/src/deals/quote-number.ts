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

const SOURCE_RANK: Record<DealQuoteSource, number> = {
	[DealQuoteSource.HUMAN]: 0,
	[DealQuoteSource.SAGE_NOTE]: 1,
	[DealQuoteSource.PO_TOOL]: 2,
	[DealQuoteSource.SAGE_DESCRIPTION]: 3,
};

export type QuotePrimaryCandidate = {
	id: string;
	dealId: string;
	quoteNumber: string;
	source: DealQuoteSource;
	createdAt: Date;
	dealName: string;
	quoteCountOnDeal: number;
};

function nameHasFullQuote(dealName: string, quoteNumber: string): boolean {
	return dealName.toUpperCase().includes(quoteNumber);
}

/**
 * Pick the one DealQuote row that should be `isPrimary` when the same
 * number sits on two or more deals.
 *
 * Unique numbers do not need a primary (Analytics uses exact). This is a
 * mechanical tie-break, not a guess about a person: observed full id in
 * the deal name, then fewest quotes on that deal, then source, then first
 * attached row.
 */
export function pickPrimaryDealQuoteId(
	quoteNumber: string,
	rows: readonly QuotePrimaryCandidate[],
): string | null {
	if (rows.length < 2) return null;
	const ranked = [...rows].toSorted((a, b) => {
		const aName = nameHasFullQuote(a.dealName, quoteNumber) ? 0 : 1;
		const bName = nameHasFullQuote(b.dealName, quoteNumber) ? 0 : 1;
		if (aName !== bName) return aName - bName;
		if (a.quoteCountOnDeal !== b.quoteCountOnDeal) {
			return a.quoteCountOnDeal - b.quoteCountOnDeal;
		}
		const source = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
		if (source !== 0) return source;
		const attached = a.createdAt.getTime() - b.createdAt.getTime();
		if (attached !== 0) return attached;
		return a.dealId.localeCompare(b.dealId);
	});
	return ranked[0]?.id ?? null;
}

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
 * New rows are not primary — `isPrimary` disambiguates one quote on
 * many deals, and {@link reconcileQuotePrimaries} sets that after insert.
 */
export async function attachDealQuotes(
	db: Db,
	dealId: string,
	quotes: readonly ParsedDealQuote[],
): Promise<number> {
	if (quotes.length === 0) return 0;

	const existing = await db.dealQuote.findMany({
		where: { dealId },
		select: { quoteNumber: true },
	});
	const have = new Set(existing.map((row) => row.quoteNumber));
	const toCreate = quotes.filter((row) => !have.has(row.quoteNumber));
	if (toCreate.length === 0) return 0;

	const data: Prisma.DealQuoteCreateManyInput[] = toCreate.map((row) => ({
		dealId,
		quoteNumber: row.quoteNumber,
		source: row.source,
		isPrimary: false,
	}));

	const result = await db.dealQuote.createMany({
		data,
		skipDuplicates: true,
	});
	if (result.count > 0) {
		await reconcileQuotePrimaries(
			db,
			toCreate.map((row) => row.quoteNumber),
		);
	}
	return result.count;
}

/**
 * `isPrimary` is a cross-deal disambiguator for one quote number.
 *
 * Unique numbers stay false (Analytics exact-join). Colliding numbers
 * get exactly one true row. Pass no numbers to repair every quote.
 */
export async function reconcileQuotePrimaries(
	db: Db,
	quoteNumbers?: readonly string[],
): Promise<{ uniqueCleared: number; collisions: number }> {
	const scoped =
		quoteNumbers && quoteNumbers.length > 0
			? { quoteNumber: { in: [...new Set(quoteNumbers)] } }
			: undefined;

	const rows = await db.dealQuote.findMany({
		where: scoped,
		select: {
			id: true,
			dealId: true,
			quoteNumber: true,
			source: true,
			isPrimary: true,
			createdAt: true,
			deal: { select: { name: true } },
		},
	});

	const byNumber = new Map<string, typeof rows>();
	for (const row of rows) {
		const group = byNumber.get(row.quoteNumber) ?? [];
		group.push(row);
		byNumber.set(row.quoteNumber, group);
	}

	const dealIds = [...new Set(rows.map((row) => row.dealId))];
	const dealCounts =
		dealIds.length === 0
			? []
			: await db.dealQuote.groupBy({
					by: ["dealId"],
					where: { dealId: { in: dealIds } },
					_count: { _all: true },
				});
	const quotesOnDeal = new Map(
		dealCounts.map((row) => [row.dealId, row._count._all]),
	);

	const uniqueIds: string[] = [];
	const collisionUpdates: { id: string; isPrimary: boolean }[] = [];
	let collisions = 0;

	for (const [quoteNumber, group] of byNumber) {
		if (group.length === 1) {
			const only = group[0];
			if (only?.isPrimary) uniqueIds.push(only.id);
			continue;
		}

		collisions += 1;
		const winnerId = pickPrimaryDealQuoteId(
			quoteNumber,
			group.map((row) => ({
				id: row.id,
				dealId: row.dealId,
				quoteNumber: row.quoteNumber,
				source: row.source,
				createdAt: row.createdAt,
				dealName: row.deal.name,
				quoteCountOnDeal: quotesOnDeal.get(row.dealId) ?? group.length,
			})),
		);
		for (const row of group) {
			const next = row.id === winnerId;
			if (row.isPrimary !== next) {
				collisionUpdates.push({ id: row.id, isPrimary: next });
			}
		}
	}

	if (uniqueIds.length > 0) {
		await db.dealQuote.updateMany({
			where: { id: { in: uniqueIds } },
			data: { isPrimary: false },
		});
	}
	for (const row of collisionUpdates) {
		await db.dealQuote.update({
			where: { id: row.id },
			data: { isPrimary: row.isPrimary },
		});
	}

	return { uniqueCleared: uniqueIds.length, collisions };
}
