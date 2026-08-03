"use client";

import { authClient, signOut } from "@crm/auth/client";
import { MS_ALL_SCOPES, SYNC_SCOPES } from "@crm/auth/scopes";
import GoogleLogo from "@crm/ui/components/brand-logos/google";
import MicrosoftLogo from "@crm/ui/components/brand-logos/microsoft";
import { Button } from "@crm/ui/components/button";
import { Spinner } from "@crm/ui/components/spinner";
import { useState } from "react";
import { toast } from "sonner";

type SyncProvider = "microsoft" | "google";

export function GrantAccess({ provider }: { provider: SyncProvider }) {
	const [pending, setPending] = useState(false);

	async function handleGrant() {
		setPending(true);

		// Absolute, like the sign-in button: the API owns /api/auth/*, so a
		// relative URL would resolve against the API's origin rather than this
		// app's. Better Auth checks it against the origins in APP_URL.
		const origin = window.location.origin;

		// `linkSocial` rather than `signIn.social`: there is already a session and
		// an account row, and this is a scope upgrade on the existing grant.
		// Microsoft: ask for sync + Mail.Send together so a re-consent also
		// unlocks sequences. Missing Mail.Send does not block the rest of the
		// app — only sequence activation checks hasMsSendScopes.
		const scopes =
			provider === "microsoft" ? [...MS_ALL_SCOPES] : [...SYNC_SCOPES];

		const { error } = await authClient.linkSocial({
			provider,
			scopes,
			callbackURL: `${origin}/`,
			errorCallbackURL: `${origin}/grant-access`,
		});

		// On success the browser has already navigated to the provider.
		if (error) {
			toast.error(
				error.message ??
					(provider === "microsoft"
						? "Could not reach Microsoft."
						: "Could not reach Google."),
			);
			setPending(false);
		}
	}

	async function handleSignOut() {
		const { error } = await signOut();

		if (error) {
			toast.error(error.message ?? "Could not sign out.");
			return;
		}

		window.location.assign("/sign-in");
	}

	const Logo = provider === "microsoft" ? MicrosoftLogo : GoogleLogo;

	return (
		<div className="flex flex-col gap-3">
			<Button
				className="w-full"
				disabled={pending}
				onClick={handleGrant}
				type="button"
			>
				{pending ? (
					<Spinner data-icon="inline-start" />
				) : (
					<Logo data-icon="inline-start" className="size-4" />
				)}
				Grant access
			</Button>

			{/*
			 * Somebody who does not want to grant this needs a way out that is not
			 * the back button into a redirect loop.
			 */}
			<Button
				className="w-full"
				onClick={() => {
					handleSignOut().catch(() => toast.error("Could not sign out."));
				}}
				type="button"
				variant="ghost"
			>
				Sign out
			</Button>
		</div>
	);
}
