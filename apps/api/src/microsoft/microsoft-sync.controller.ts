import {
	Controller,
	ForbiddenException,
	Get,
	Headers,
	Logger,
	Post,
	ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { EnvironmentVariables } from "../config/env.validation";
import { MicrosoftSyncService } from "./microsoft-sync.service";

/**
 * The Microsoft cron entrypoint.
 *
 * The twin of Google's `SyncController`, on the same `internal/sync` base but
 * its own `microsoft` sub-path. No user makes this request, so there is no
 * session to authenticate; `CRON_SECRET` is the guard instead.
 */
@Controller("internal/sync")
export class MicrosoftSyncController {
	private readonly logger = new Logger(MicrosoftSyncController.name);
	private readonly secret: string | undefined;

	constructor(
		private readonly sync: MicrosoftSyncService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("CRON_SECRET", { infer: true });
	}

	/**
	 * `GET`, because Vercel Cron only issues `GET`.
	 *
	 * Two handlers rather than two decorators on one: Nest keeps only the last
	 * HTTP-method decorator applied to a method, so stacking them silently
	 * registers one verb and drops the other.
	 */
	@Get("microsoft")
	@AllowAnonymous()
	async microsoftViaGet(@Headers("authorization") authorization?: string) {
		return this.microsoft(authorization);
	}

	/** The same thing, for anything calling it by hand. */
	@Post("microsoft")
	@AllowAnonymous()
	async microsoftViaPost(@Headers("authorization") authorization?: string) {
		return this.microsoft(authorization);
	}

	private async microsoft(authorization?: string) {
		// No secret configured means the route is open, which is worse than it
		// being unavailable. Fail closed.
		if (!this.secret) {
			this.logger.error({
				message: "CRON_SECRET is not set — refusing to run the sync route.",
			});
			throw new ServiceUnavailableException("Sync is not configured.");
		}

		if (!timingSafeEquals(authorization ?? "", `Bearer ${this.secret}`)) {
			throw new ForbiddenException();
		}

		return this.sync.runDue();
	}
}

/**
 * Constant-time string comparison.
 *
 * A `===` on a shared secret leaks its prefix through response timing. The
 * length check up front is fine to leak — it is the content that matters.
 */
function timingSafeEquals(a: string, b: string): boolean {
	if (a.length !== b.length) return false;

	let mismatch = 0;
	for (let index = 0; index < a.length; index += 1) {
		mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
	}

	return mismatch === 0;
}
