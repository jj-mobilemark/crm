// `better-auth generate` loads this file directly, without going through
// `@crm/db` — so the root `.env` has to be picked up here too.
import "@crm/env/load";

/**
 * Auth configuration, and the defaults that keep it to four required values.
 *
 * Everything here except the Google credentials has a working localhost
 * default. That is the difference between a clone that runs and a clone that
 * makes you read a table of variables first, and the defaults are only ever
 * right for localhost — `API_URL` and `APP_URL` have to be set for any real
 * deployment, which is why they are the first two lines of `.env.example`.
 */

const DEFAULT_API_URL = "http://localhost:3001";
const DEFAULT_APP_URL = "http://localhost:3000";

const optional = (key: string): string | undefined => {
	const value = process.env[key];
	return value && value.length > 0 ? value : undefined;
};

const googleCredentials = ():
	| { clientId: string; clientSecret: string }
	| undefined => {
	const clientId = optional("GOOGLE_CLIENT_ID");
	const clientSecret = optional("GOOGLE_CLIENT_SECRET");

	if (!clientId || !clientSecret) {
		if (clientId || clientSecret) {
			throw new Error(
				"GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together.",
			);
		}
		return undefined;
	}

	return { clientId, clientSecret };
};

const microsoftCredentials = ():
	| { clientId: string; clientSecret: string; tenantId: string }
	| undefined => {
	const clientId = optional("MICROSOFT_CLIENT_ID");
	const clientSecret = optional("MICROSOFT_CLIENT_SECRET");
	const tenantId = optional("MICROSOFT_TENANT_ID");

	if (!clientId || !clientSecret || !tenantId) {
		if (clientId || clientSecret || tenantId) {
			throw new Error(
				"MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, and MICROSOFT_TENANT_ID must be set together.",
			);
		}
		return undefined;
	}

	return { clientId, clientSecret, tenantId };
};

/**
 * Where the API is — the origin that mints session cookies and serves
 * `/api/auth/*`.
 *
 * `BETTER_AUTH_URL` is still read because Better Auth's own tooling looks for
 * it, but `API_URL` is the name in `.env.example`: one origin should not have
 * two spellings depending on which library is asking.
 */
const apiUrl =
	optional("API_URL") ?? optional("BETTER_AUTH_URL") ?? DEFAULT_API_URL;

/**
 * Where the browser is.
 *
 * Comma-separated, because a preview deployment and a production domain are
 * both legitimately "the app" — but the first one is canonical, and that is the
 * one sign-in redirects back to. This replaced a separate
 * `AUTH_TRUSTED_ORIGINS`: the set of origins allowed to call the API with
 * credentials was always exactly the set of places the app is served from, so
 * two variables could only ever disagree.
 */
const appUrls = (optional("APP_URL") ?? DEFAULT_APP_URL)
	.split(",")
	.map((origin) => origin.trim())
	.filter(Boolean);

const appUrl = appUrls[0] ?? DEFAULT_APP_URL;

export const env = {
	appUrl: apiUrl,
	google: googleCredentials(),
	microsoft: microsoftCredentials(),
	cookieDomain: optional("AUTH_COOKIE_DOMAIN"),
	// The API's own origin is trusted too: Better Auth validates the
	// post-sign-in `callbackURL` against this list, and the OAuth round trip
	// starts and ends on the API.
	trustedOrigins: [...new Set([...appUrls, apiUrl])],
	isProduction: process.env.NODE_ENV === "production",
} as const;

export { apiUrl, appUrl };
