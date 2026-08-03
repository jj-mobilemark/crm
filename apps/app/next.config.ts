import { loadRootEnv } from "@crm/env";
import type { NextConfig } from "next";

// Next only looks for `.env` files beside the app. The one in this repo is at
// the workspace root, so it is read here — before `env` below is evaluated.
loadRootEnv();

/**
 * The API origin, published to the browser.
 *
 * Self-hosters set `API_URL` once and both sides of the app agree: the server
 * components fetching tRPC and the browser sending someone to sign in. This
 * used to be two separate `NEXT_PUBLIC_*` variables that had to hold the same
 * value, which is one variable more than there are origins.
 *
 * `env` rather than a runtime read, because `NEXT_PUBLIC_*` is inlined at build
 * time and a value that only exists in the root `.env` would otherwise be
 * `undefined` in the bundle.
 *
 * `NEXT_PUBLIC_API_URL` is still honoured as a fallback. It is the name this
 * used to have, and a deployment that still sets it must not be silently
 * rewritten to `localhost` by the default below — that failure builds and
 * deploys cleanly, then every request from the browser goes to the reader's own
 * machine.
 */
const apiUrl =
	process.env.API_URL ??
	process.env.NEXT_PUBLIC_API_URL ??
	"http://localhost:3001";

// Fail Railway/CI builds early if the browser would still point at localhost —
// that deploys cleanly, then every auth call CORS-fails in production.
if (
	(process.env.RAILWAY_ENVIRONMENT || process.env.CI) &&
	(/localhost|127\.0\.0\.1/.test(apiUrl) || !apiUrl)
) {
	throw new Error(
		`API_URL must be a public origin for production builds (got ${JSON.stringify(apiUrl)}). Set API_URL on the app service and declare ARG/ENV in Dockerfile.app.`,
	);
}

const nextConfig: NextConfig = {
	env: {
		NEXT_PUBLIC_API_URL: apiUrl,
	},

	// The @crm/* packages are just-in-time: they ship TypeScript sources, so
	// Next has to compile them rather than treat them as prebuilt dependencies.
	transpilePackages: ["@crm/auth", "@crm/db", "@crm/ui"],

	// Prisma's runtime and the pg driver are Node-only and resolve files at
	// runtime; bundling them breaks that. @crm/db itself is still transpiled.
	serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],

	images: {
		remotePatterns: [
			// Google account avatars, which arrive as `user.image`.
			{ protocol: "https", hostname: "lh3.googleusercontent.com" },
		],
	},

	experimental: {
		// The app shell uses `view-transition-name` and <Link transitionTypes>.
		viewTransition: true,
	},
};

export default nextConfig;
