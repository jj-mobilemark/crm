import { mapContact } from "./sage.mappings";
import type { SageCompanyTree } from "./sage-xml";

/**
 * Pure helpers for the Sage backfill, kept free of Nest/Prisma so they can be
 * unit-tested without booting the DI graph or touching a database.
 */

/** People under a company tree that would map to a real Contact (dry-run count). */
export function countMappableContacts(tree: SageCompanyTree): number {
	let count = 0;
	for (const person of tree.people) {
		if (mapContact(person, tree.company.companyid)) count += 1;
	}
	return count;
}

/**
 * Larger of two numeric-string ids, ignoring non-numeric values.
 *
 * The backfill records the max `companyid` seen as a coarse progress marker.
 */
export function maxNumericId(
	current: string | null,
	candidate: string | undefined,
): string | null {
	if (!candidate || !/^\d+$/.test(candidate)) return current;
	if (current === null) return candidate;
	return Number(candidate) > Number(current) ? candidate : current;
}

/** Sage's local ISO datetime shape (`2026-07-30T16:50:58`), no timezone. */
export function sageDate(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
		`T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
	);
}
