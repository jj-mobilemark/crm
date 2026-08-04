/**
 * Secondary line for company pickers / match dialogs so reps can tell
 * duplicate Sage imports apart (customer # + contact volume).
 *
 * Omits missing pieces; always includes contact count (including zero).
 */
export function formatCompanyDisambiguation(parts: {
	sage100CustomerNo?: string | null;
	contactCount: number;
}): string {
	const bits: string[] = [];
	if (parts.sage100CustomerNo) {
		bits.push(parts.sage100CustomerNo);
	}
	const n = parts.contactCount;
	bits.push(`${n} contact${n === 1 ? "" : "s"}`);
	return bits.join(" · ");
}
