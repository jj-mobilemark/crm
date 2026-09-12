import { DealStage } from "@crm/db";

const BUSINESS_TZ = "America/Chicago";

/**
 * Actual close date for a Sage-synced deal.
 *
 * Sage `closed` wins when it is a real past-or-today date. Forecast
 * (`targetclose`) and open date are never copied. A later sync must not
 * move a frozen `closedAt` unless Sage later sends a usable `closed`.
 * Future dates are rejected even when Sage filled `closed`.
 *
 * On a closed deal with no usable Sage `closed` and no usable existing
 * date, stamp `now` once (first observed close). That is only for the
 * forward path — do not run it as a historical backfill.
 */
export function resolvedClosedAt(input: {
	stage: DealStage;
	sageClosedAt: Date | null;
	existingClosedAt?: Date | null;
	now?: Date;
}): Date | null {
	if (!isClosedDealStage(input.stage)) return null;

	const now = input.now ?? new Date();
	if (isUsableCloseDate(input.sageClosedAt, now)) {
		return input.sageClosedAt;
	}
	if (isUsableCloseDate(input.existingClosedAt, now)) {
		return input.existingClosedAt;
	}
	return now;
}

export function isClosedDealStage(stage: DealStage): boolean {
	return (
		stage === DealStage.CLOSED_WON || stage === DealStage.CLOSED_LOST
	);
}

/** True when `date` is a real instant on or before today's Chicago date. */
export function isUsableCloseDate(
	date: Date | null | undefined,
	now: Date,
): date is Date {
	if (!date || Number.isNaN(date.getTime())) return false;
	return chicagoDate(date) <= chicagoDate(now);
}

function chicagoDate(value: Date): string {
	return value.toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ });
}
