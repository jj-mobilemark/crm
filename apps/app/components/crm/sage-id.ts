/**
 * Sage 100 customer key shown to reps, e.g. "00-0000777".
 *
 * null when the company has no Sage 100 link (CRM-only).
 */
export function formatSage100Id(
	arDivisionNo: string | null | undefined,
	customerNo: string | null | undefined,
): string | null {
	if (!customerNo) return null;
	return arDivisionNo ? `${arDivisionNo}-${customerNo}` : customerNo;
}
