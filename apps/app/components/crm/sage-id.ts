/**
 * Sage 100 customer key shown to reps, e.g. "0011246".
 *
 * The AR division (always "00" here) is not used by the team, so only the
 * customer number is shown/copied. The division is still stored on the company
 * for the Sage 100 -> MasHeader order-history join (plan §3.1 / §8).
 *
 * `arDivisionNo` is kept in the signature so callers do not change; it is
 * intentionally ignored.
 *
 * null when the company has no Sage 100 link (CRM-only).
 */
export function formatSage100Id(
	_arDivisionNo: string | null | undefined,
	customerNo: string | null | undefined,
): string | null {
	return customerNo ?? null;
}
