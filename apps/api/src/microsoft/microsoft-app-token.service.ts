import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../config/env.validation";

type TokenCache = {
	accessToken: string;
	expiresAtMs: number;
};

/**
 * App-only Microsoft Graph token (client credentials).
 *
 * Used for the shared webform mailbox — no CRM user "owns" info@. Requires
 * application `Mail.Read` (and typically an Exchange application access
 * policy that scopes that permission to WEBFORM_MAILBOX). Missing env
 * removes the capability; callers must check `isConfigured()`.
 */
@Injectable()
export class MicrosoftAppTokenService {
	private readonly logger = new Logger(MicrosoftAppTokenService.name);
	private cache: TokenCache | null = null;

	constructor(
		private readonly config: ConfigService<EnvironmentVariables, true>,
	) {}

	isConfigured(): boolean {
		const clientId = this.config.get("MICROSOFT_CLIENT_ID", { infer: true });
		const clientSecret = this.config.get("MICROSOFT_CLIENT_SECRET", {
			infer: true,
		});
		const tenantId = this.config.get("MICROSOFT_TENANT_ID", { infer: true });
		return Boolean(clientId && clientSecret && tenantId);
	}

	async getAccessToken(): Promise<string | null> {
		if (!this.isConfigured()) return null;

		const now = Date.now();
		if (this.cache && this.cache.expiresAtMs > now + 60_000) {
			return this.cache.accessToken;
		}

		const clientId = this.config.get("MICROSOFT_CLIENT_ID", { infer: true });
		const clientSecret = this.config.get("MICROSOFT_CLIENT_SECRET", {
			infer: true,
		});
		const tenantId = this.config.get("MICROSOFT_TENANT_ID", { infer: true });
		if (!clientId || !clientSecret || !tenantId) return null;

		const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
		const body = new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			scope: "https://graph.microsoft.com/.default",
			grant_type: "client_credentials",
		});

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body,
			});
			if (!response.ok) {
				const text = await response.text();
				this.logger.warn({
					message: "App-only Graph token request failed",
					status: response.status,
					body: text.slice(0, 400),
				});
				return null;
			}

			const json = (await response.json()) as {
				access_token?: string;
				expires_in?: number;
			};
			if (!json.access_token) return null;

			this.cache = {
				accessToken: json.access_token,
				expiresAtMs: now + (json.expires_in ?? 3600) * 1000,
			};
			return json.access_token;
		} catch (error) {
			this.logger.warn({
				message: "App-only Graph token request threw",
				error: error instanceof Error ? error.message : String(error),
			});
			return null;
		}
	}
}
