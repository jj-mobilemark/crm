import { FieldSeparator } from "@crm/ui/components/field";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { getSession } from "@/lib/session";
import { CredentialsForm } from "./credentials-form";
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

	const hasSocial = microsoftEnabled || googleEnabled;

	return (
		<AuthShell>
			<AuthHeading
				title="Welcome back"
				description="Sign in with your email and password to continue."
			/>

			<CredentialsForm />

			{hasSocial && <FieldSeparator>or</FieldSeparator>}

			{microsoftEnabled && <MicrosoftSignIn />}
			{googleEnabled && <GoogleSignIn />}

			<p className="text-center text-muted-foreground text-sm/5">
				Mobile Mark CRM is internal. Sign-in is for existing accounts only —
				ask an admin if you need access.
			</p>
		</AuthShell>
	);
}
