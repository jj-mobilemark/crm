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
import { FollowupsService } from "./followups.service";

/**
 * The daily follow-up sweep's cron entrypoint.
 *
 * Same shape as `MicrosoftSyncController`: no user makes this request, so
 * `CRON_SECRET` is the guard rather than a session. One tick a day queues one
 * `AgentTask` per mailbox-connected rep; the dispatcher in `apps/agent` runs
 * each one on its own clock from there.
 */
@Controller("internal/agent")
export class FollowupsController {
	private readonly logger = new Logger(FollowupsController.name);
	private readonly secret: string | undefined;

	constructor(
		private readonly followups: FollowupsService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("CRON_SECRET", { infer: true });
	}

	/** `GET`, because Vercel Cron only issues `GET`. */
	@Get("followups")
	@AllowAnonymous()
	async followupsViaGet(@Headers("authorization") authorization?: string) {
		return this.enqueue(authorization);
	}

	/** The same thing, for anything calling it by hand. */
	@Post("followups")
	@AllowAnonymous()
	async followupsViaPost(@Headers("authorization") authorization?: string) {
		return this.enqueue(authorization);
	}

	private async enqueue(authorization?: string) {
		if (!this.secret) {
			this.logger.error({
				message:
					"CRON_SECRET is not set — refusing to run the followups route.",
			});
			throw new ServiceUnavailableException(
				"The follow-up sweep is not configured.",
			);
		}

		if (!timingSafeEquals(authorization ?? "", `Bearer ${this.secret}`)) {
			throw new ForbiddenException();
		}

		return this.followups.enqueueDue();
	}
}

/** Constant-time string comparison — a `===` on a shared secret leaks its
 * prefix through response timing. */
function timingSafeEquals(a: string, b: string): boolean {
	if (a.length !== b.length) return false;

	let mismatch = 0;
	for (let index = 0; index < a.length; index += 1) {
		mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
	}

	return mismatch === 0;
}
