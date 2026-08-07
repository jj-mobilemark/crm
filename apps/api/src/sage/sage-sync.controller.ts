import {
	Controller,
	ForbiddenException,
	Get,
	Headers,
	HttpException,
	HttpStatus,
	Logger,
	Post,
	ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { EnvironmentVariables } from "../config/env.validation";
import { SagePullService } from "./sage-pull.service";
import { SagePushService } from "./sage-push.service";

/**
 * Sage CRM sync entrypoint (pull + push flush).
 *
 * Same shape as `MicrosoftSyncController`: no user session; `CRON_SECRET` is
 * the guard. Pull runs first (test-slice or incremental). Push flush drains the
 * SageOutbox under the same single-session lock rule — sequentially after pull
 * so they never open two Sage sessions at once.
 */
@Controller("internal/sync")
export class SageSyncController {
	private readonly logger = new Logger(SageSyncController.name);
	private readonly secret: string | undefined;

	constructor(
		private readonly pull: SagePullService,
		private readonly push: SagePushService,
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

		// Pull first (holds the session lock), then drain the outbox. Busy on
		// flush means another holder still has the lock — next cron picks it up.
		const pull = await this.pull.runScheduled();
		const push = await this.push.flush();
		const body = { pull, push };

		// Railway cron uses `curl -f` and treats HTTP 2xx as success. A JSON
		// body with outcome=failed used to look green in the dashboard even
		// when the Sage session dropped mid-pull — surface those as 503.
		if (isHardSyncFailure(pull.outcome) || isHardSyncFailure(push.outcome)) {
			this.logger.error({
				message: "Sage sync finished with a hard failure",
				pullOutcome: pull.outcome,
				pushOutcome: push.outcome,
				pullReason: "reason" in pull ? pull.reason : undefined,
				pushReason: "reason" in push ? push.reason : undefined,
			});
			throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
		}

		return body;
	}
}

function isHardSyncFailure(outcome: string): boolean {
	return (
		outcome === "failed" ||
		outcome === "auth-failed" ||
		outcome === "not-configured"
	);
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
