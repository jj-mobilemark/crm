import { primaryWorkspaceDomain } from "@crm/auth/workspace";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { getSession } from "@/lib/session";
import { GoogleSignIn } from "./google-sign-in";
import { MicrosoftSignIn } from "./microsoft-sign-in";

export const metadata: Metadata = {
	title: "Sign in",
};

// Social buttons only appear when a real OAuth client is configured.
const microsoftEnabled = Boolean(
	process.env.MICROSOFT_CLIENT_ID &&
		process.env.MICROSOFT_CLIENT_SECRET &&
		process.env.MICROSOFT_TENANT_ID,
);
const googleEnabled = Boolean(
	process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);

export default async function SignInPage() {
	// The authoritative counterpart to the cookie sniff in `proxy.ts`, and the
	// reason that check is not in the proxy: only a session that verifies
	// against Postgres sends you back into the app. A cookie that no longer
	// resolves falls through to the form instead of ping-ponging with `/`.
	//
	// A database that cannot answer must not take this page down with it — it is
	// the one page that has to work when everything else is broken, so a failed
	// lookup counts as signed out.
	const session = await getSession().catch((error: unknown) => {
		console.error("Sign-in: could not read the session.", error);
		return null;
	});

	if (session) {
		redirect("/");
	}

	const domain = primaryWorkspaceDomain();
	const domainHint = domain ? `@${domain}` : "your company";

	return (
		<AuthShell>
			<AuthHeading
				title="Welcome back"
				description={`Sign in with your ${domainHint} Microsoft account to continue.`}
			/>

			{microsoftEnabled ? (
				<MicrosoftSignIn />
			) : (
				<p className="text-center text-muted-foreground text-sm/5">
					Microsoft sign-in is not configured. Set MICROSOFT_CLIENT_ID,
					MICROSOFT_CLIENT_SECRET, and MICROSOFT_TENANT_ID, then restart.
				</p>
			)}

			{/* Optional Google button for installs that still configure it. */}
			{googleEnabled && <GoogleSignIn />}

			<p className="text-center text-muted-foreground text-sm/5">
				{domain
					? `Anyone with an @${domain} account can sign in. Your first visit creates your CRM account.`
					: "This CRM is private. Sign-in creates your account when your address is on the allow-list."}
			</p>
		</AuthShell>
	);
}
