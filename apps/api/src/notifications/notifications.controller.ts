import {
	Controller,
	ForbiddenException,
	Get,
	Headers,
	Logger,
	Post,
	Query,
	ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { EnvironmentVariables } from "../config/env.validation";
import { DailyTaskPushService } from "./daily-task-push.service";

/**
 * Cron entrypoint for the morning open-task email.
 *
 * Same shape as `FollowupsController`: no user session — `CRON_SECRET` guards
 * the route. `force=1` skips the Chicago hour-9 gate for local smoke tests.
 */
@Controller("internal/notifications")
export class NotificationsController {
	private readonly logger = new Logger(NotificationsController.name);
	private readonly secret: string | undefined;

	constructor(
		private readonly dailyTasks: DailyTaskPushService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("CRON_SECRET", { infer: true });
	}

	@Get("daily-tasks")
	@AllowAnonymous()
	async dailyTasksViaGet(
		@Headers("authorization") authorization?: string,
		@Query("force") force?: string,
	) {
		return this.run(authorization, force === "1" || force === "true");
	}

	@Post("daily-tasks")
	@AllowAnonymous()
	async dailyTasksViaPost(
		@Headers("authorization") authorization?: string,
		@Query("force") force?: string,
	) {
		return this.run(authorization, force === "1" || force === "true");
	}

	private async run(authorization: string | undefined, force: boolean) {
		if (!this.secret) {
			this.logger.error({
				message:
					"CRON_SECRET is not set — refusing to run the daily-tasks route.",
			});
			throw new ServiceUnavailableException(
				"Daily task push is not configured.",
			);
		}

		if (!timingSafeEquals(authorization ?? "", `Bearer ${this.secret}`)) {
			throw new ForbiddenException();
		}

		return this.dailyTasks.run({ force });
	}
}

function timingSafeEquals(a: string, b: string): boolean {
	if (a.length !== b.length) return false;

	let mismatch = 0;
	for (let index = 0; index < a.length; index += 1) {
		mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
	}

	return mismatch === 0;
}
