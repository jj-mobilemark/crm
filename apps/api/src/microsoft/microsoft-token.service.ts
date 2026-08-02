import { auth } from "@crm/auth";
import { type Db } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import {
	MICROSOFT_PROVIDER_ID,
	SCOPE_FOR_SOURCE,
	type SyncSource,
} from "./microsoft.constants";

/** Why a token could not be produced. Callers branch on this, not on a string. */
export type TokenFailure =
	/** No refresh token, or Microsoft rejected it. The rep has to reconnect. */
	| { outcome: "needs-reconnect"; reason: string }
	/** The grant never included this scope. Not an error — just not connected. */
	| { outcome: "not-connected"; reason: string };

export type TokenResult = { outcome: "ok"; accessToken: string } | TokenFailure;

/** Microsoft stores Graph scopes either short (`Mail.Read`) or as full URIs. */
const GRAPH_SCOPE_PREFIX = "https://graph.microsoft.com/";

/**
 * The only place a Microsoft Graph access token is obtained.
 *
 * Nothing reads `Account.accessToken` directly: Better Auth's `getAccessToken`
 * refreshes an expired token and persists the new one, so a hand-rolled refresh
 * would be a second, worse implementation of the same thing racing the first.
 */
@Injectable()
export class MicrosoftTokenService {
	private readonly logger = new Logger(MicrosoftTokenService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	/**
	 * The scopes Microsoft has actually granted this user, from the account row.
	 *
	 * Normalised to short names: Microsoft may return `Mail.Read` or
	 * `https://graph.microsoft.com/Mail.Read`, and `SCOPE_FOR_SOURCE` holds the
	 * short form, so both grants have to compare equal.
	 */
	async grantedScopes(userId: string): Promise<string[]> {
		const account = await this.db.account.findFirst({
			where: { userId, providerId: MICROSOFT_PROVIDER_ID },
			select: { scope: true },
		});

		return (
			account?.scope
				// Microsoft returns the grant space- or comma-separated.
				?.split(/[,\s]+/)
				.map((scope) => scope.trim())
				.filter(Boolean)
				.map((scope) =>
					scope.startsWith(GRAPH_SCOPE_PREFIX)
						? scope.slice(GRAPH_SCOPE_PREFIX.length)
						: scope,
				) ?? []
		);
	}

	/** Whether the grant covers a source. The grant *is* the connection state. */
	async isConnected(userId: string, source: SyncSource): Promise<boolean> {
		const scopes = await this.grantedScopes(userId);
		return scopes.includes(SCOPE_FOR_SOURCE[source]);
	}

	/**
	 * Whether Microsoft issued a refresh token for this grant.
	 *
	 * Without `offline_access` there is no refresh token, and everything works
	 * until the access token expires an hour later — so the connect flow checks
	 * this immediately rather than discovering it on the first cron tick.
	 */
	async hasRefreshToken(userId: string): Promise<boolean> {
		const account = await this.db.account.findFirst({
			where: { userId, providerId: MICROSOFT_PROVIDER_ID },
			select: { refreshToken: true },
		});

		return Boolean(account?.refreshToken);
	}

	/**
	 * A valid access token for a source, or why there isn't one.
	 *
	 * Returns a result rather than throwing: "this rep never connected Outlook"
	 * is an ordinary state for a cron tick iterating every user, not an
	 * exception.
	 */
	async accessTokenFor(
		userId: string,
		source: SyncSource,
	): Promise<TokenResult> {
		if (!(await this.isConnected(userId, source))) {
			return {
				outcome: "not-connected",
				reason: `The ${source} scope has not been granted.`,
			};
		}

		try {
			const { accessToken } = await auth.api.getAccessToken({
				body: { providerId: MICROSOFT_PROVIDER_ID, userId },
			});

			if (!accessToken) {
				return {
					outcome: "needs-reconnect",
					reason: "Microsoft returned no access token.",
				};
			}

			return { outcome: "ok", accessToken };
		} catch (error) {
			// A refresh failure means the refresh token is gone — revoked, expired
			// or never issued. Retrying cannot fix it, so this is terminal until
			// the rep reconnects.
			this.logger.warn({
				message: "Microsoft token refresh failed",
				userId,
				source,
				reason: error instanceof Error ? error.message : String(error),
			});

			return {
				outcome: "needs-reconnect",
				reason: "Microsoft would not refresh the access token.",
			};
		}
	}

	/**
	 * Ends the connection by clearing the stored tokens.
	 *
	 * Microsoft (Entra) has no simple public token-revocation endpoint the way
	 * Google does — a delegated grant is revoked from the tenant admin portal or
	 * the user's own account page, not by a one-line POST. So the local exit is
	 * to drop the tokens we hold: the next Graph call has nothing to send, and
	 * the rep is treated as disconnected. The grant itself may still exist on
	 * Microsoft's side until the user removes it there.
	 */
	async revoke(userId: string): Promise<boolean> {
		const account = await this.db.account.findFirst({
			where: { userId, providerId: MICROSOFT_PROVIDER_ID },
			select: { id: true },
		});

		if (!account) return false;

		await this.db.account.updateMany({
			where: { userId, providerId: MICROSOFT_PROVIDER_ID },
			data: {
				accessToken: null,
				refreshToken: null,
				scope: null,
				accessTokenExpiresAt: null,
				refreshTokenExpiresAt: null,
			},
		});

		this.logger.log({ message: "Microsoft tokens cleared", userId });
		return true;
	}
}
