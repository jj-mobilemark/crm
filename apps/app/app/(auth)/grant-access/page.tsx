import { hasMsSyncScopes, hasSyncScopes } from "@crm/auth";
import { db } from "@crm/db";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { requireSession } from "@/lib/session";
import { GrantAccess } from "./grant-access";

export const metadata: Metadata = {
	title: "Grant access",
};

const microsoftEnabled = Boolean(
	process.env.MICROSOFT_CLIENT_ID &&
		process.env.MICROSOFT_CLIENT_SECRET &&
		process.env.MICROSOFT_TENANT_ID,
);

/**
 * The re-consent wall.
 *
 * Outside the `(app)` group deliberately: the gate lives in that group's
 * layout, so a page inside it would redirect to itself.
 *
 * Reached by someone who is signed in but has not granted mail and calendar —
 * either they declined a scope on the consent screen, or their account
 * predates those scopes being required.
 */
export default async function GrantAccessPage() {
	const { user } = await requireSession();

	// Prefer Microsoft when configured; otherwise fall back to Google.
	const provider = microsoftEnabled ? "microsoft" : "google";
	const hasScopes = provider === "microsoft" ? hasMsSyncScopes : hasSyncScopes;

	const account = await db.account.findFirst({
		where: { userId: user.id, providerId: provider },
		select: { scope: true },
	});

	// Already granted — nothing to ask for. Guards the back button and a stale
	// link as much as anything.
	if (hasScopes(account?.scope)) {
		redirect("/");
	}

	const mailboxLabel =
		provider === "microsoft"
			? "Outlook mail and calendar"
			: "Gmail and Calendar";

	return (
		<AuthShell>
			<AuthHeading
				title="One more step"
				description={`Comp AI CRM reads your ${mailboxLabel} so meetings and email threads show up on the right company. It is read-only — nothing is ever sent on your behalf.`}
			/>

			<GrantAccess provider={provider} />

			<p className="text-center text-muted-foreground text-sm/5">
				Only conversations with companies in the CRM are stored. Personal mail
				is discarded without being saved.
			</p>
		</AuthShell>
	);
}
