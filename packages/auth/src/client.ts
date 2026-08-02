import { createAuthClient } from "better-auth/react";

/**
 * The browser's view of auth.
 *
 * Points at the API, which is the only process that mounts `/api/auth/*`. The
 * origin is inlined at build time from `API_URL` — see `next.config.ts`.
 */
export const authClient = createAuthClient({
	baseURL: process.env.NEXT_PUBLIC_API_URL,
});

export const { getSession, signIn, signOut, signUp, useSession } = authClient;

export type AuthClient = typeof authClient;
