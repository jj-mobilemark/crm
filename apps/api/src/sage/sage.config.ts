/**
 * Sage SOAP credentials, all-three-or-none.
 *
 * Mirrors `googleCredentials()` in `@crm/auth`: a missing capability removes the
 * feature, it never throws — but a HALF-set config is a mistake worth failing
 * loudly for, so a partial set throws with a clear message.
 */

export type SageCredentials = {
	url: string;
	user: string;
	password: string;
};

export function sageCredentials(env: {
	SAGE_SOAP_URL?: string;
	SAGE_SOAP_USER?: string;
	SAGE_SOAP_PASSWORD?: string;
}): SageCredentials | undefined {
	const url = blank(env.SAGE_SOAP_URL);
	const user = blank(env.SAGE_SOAP_USER);
	const password = blank(env.SAGE_SOAP_PASSWORD);

	if (!url && !user && !password) return undefined;

	if (!url || !user || !password) {
		throw new Error(
			"SAGE_SOAP_URL, SAGE_SOAP_USER and SAGE_SOAP_PASSWORD must be set together (or all left empty to disable the Sage sync).",
		);
	}

	return { url, user, password };
}

function blank(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : undefined;
}
