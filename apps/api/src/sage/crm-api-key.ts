import {
	ForbiddenException,
	ServiceUnavailableException,
} from "@nestjs/common";

/**
 * Guard for external CRM read endpoints (`order-defaults`, `resolve`).
 * Same secret (`CRM_API_KEY`) and constant-time compare as the quoting
 * app's `X-API-Key` style — not the cron Bearer secret.
 */
export function assertCrmApiKey(
	configured: string | undefined,
	provided: string | undefined,
): void {
	if (!configured) {
		throw new ServiceUnavailableException("CRM_API_KEY is not configured.");
	}
	if (!timingSafeEquals(provided ?? "", configured)) {
		throw new ForbiddenException();
	}
}

function timingSafeEquals(a: string, b: string): boolean {
	if (a.length !== b.length) return false;

	let mismatch = 0;
	for (let index = 0; index < a.length; index += 1) {
		mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
	}

	return mismatch === 0;
}
