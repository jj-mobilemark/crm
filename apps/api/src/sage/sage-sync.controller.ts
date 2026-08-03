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
import { SagePullService } from "./sage-pull.service";

/**
 * Sage CRM sync entrypoint (test-slice first).
 *
 * Same shape as `MicrosoftSyncController`: no user session; `CRON_SECRET` is
 * the guard. The test-slice import is small (~8 companies) and safe to run on
 * demand. The full ~14k backfill must NOT go through this web route — that is
 * a Railway worker (see plan section 6.3).
 */
@Controller("internal/sync")
export class SageSyncController {
	private readonly logger = new Logger(SageSyncController.name);
	private readonly secret: string | undefined;

	constructor(
		private readonly pull: SagePullService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("CRON_SECRET", { infer: true });
	}

	/** `GET`, because Vercel Cron only issues `GET`. */
	@Get("sage")
	@AllowAnonymous()
	async sageViaGet(@Headers("authorization") authorization?: string) {
		return this.sage(authorization);
	}

	/** The same thing, for anything calling it by hand. */
	@Post("sage")
	@AllowAnonymous()
	async sageViaPost(@Headers("authorization") authorization?: string) {
		return this.sage(authorization);
	}

	private async sage(authorization?: string) {
		if (!this.secret) {
			this.logger.error({
				message: "CRON_SECRET is not set — refusing to run the sync route.",
			});
			throw new ServiceUnavailableException("Sync is not configured.");
		}

		if (!timingSafeEquals(authorization ?? "", `Bearer ${this.secret}`)) {
			throw new ForbiddenException();
		}

		// Test slice until the one-shot backfill flips the phase, then nightly
		// incremental — see `SagePullService.runScheduled`.
		return this.pull.runScheduled();
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
