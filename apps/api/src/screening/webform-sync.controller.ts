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
import { WebformIngestService } from "./webform-ingest.service";

/**
 * Cron entrypoint for shared-mailbox Customer Question ingest.
 *
 * Same CRON_SECRET guard as Microsoft / daily-tasks sync. Safe to call when
 * WEBFORM_MAILBOX is unset — the service reports skipped.
 */
@Controller("internal/sync")
export class WebformSyncController {
	private readonly logger = new Logger(WebformSyncController.name);
	private readonly secret: string | undefined;

	constructor(
		private readonly ingest: WebformIngestService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("CRON_SECRET", { infer: true });
	}

	@Get("webform")
	@AllowAnonymous()
	async viaGet(@Headers("authorization") authorization?: string) {
		return this.run(authorization);
	}

	@Post("webform")
	@AllowAnonymous()
	async viaPost(@Headers("authorization") authorization?: string) {
		return this.run(authorization);
	}

	private async run(authorization?: string) {
		if (!this.secret) {
			this.logger.error({
				message: "CRON_SECRET is not set — refusing webform sync.",
			});
			throw new ServiceUnavailableException("Sync is not configured.");
		}

		if (!timingSafeEquals(authorization ?? "", `Bearer ${this.secret}`)) {
			throw new ForbiddenException();
		}

		return this.ingest.run();
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
