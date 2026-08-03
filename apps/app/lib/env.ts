/**
 * Where the NestJS API lives for the browser.
 *
 * Public because the auth client needs it for sign-in redirects. `next.config.ts`
 * inlines this from `API_URL` at build time.
 */
export const API_URL =
	process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Where the Next.js server reaches Nest (same-origin proxy + RSC tRPC).
 *
 * When the public API hostname sits behind Cloudflare (or another CDN), a
 * server→public hairpin from the app container fails with an HTML error page
 * ("DNS points to prohibited IP"). Prefer the platform's private URL in that
 * case — on Railway: `http://api.railway.internal:3001`. Locally the public
 * and internal origins are the same, so this falls back to `API_URL`.
 */
export const INTERNAL_API_URL =
	process.env.INTERNAL_API_URL ?? API_URL;
