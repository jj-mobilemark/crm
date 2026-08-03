import {
	Controller,
	ForbiddenException,
	Get,
	Headers,
	Logger,
	Param,
	Post,
	Query,
	Res,
	ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { Response } from "express";
import type { EnvironmentVariables } from "../config/env.validation";
import { SequenceTickService } from "./sequence-tick.service";

/** 1×1 transparent GIF for open tracking. */
const PIXEL_GIF = Buffer.from(
	"R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
	"base64",
);

/**
 * Sequence cron tick + public tracking / unsubscribe endpoints.
 */
@Controller()
export class SequencesController {
	private readonly logger = new Logger(SequencesController.name);
	private readonly secret: string | undefined;

	constructor(
		private readonly tick: SequenceTickService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("CRON_SECRET", { infer: true });
	}

	@Get("internal/sequences/tick")
	@AllowAnonymous()
	async tickViaGet(@Headers("authorization") authorization?: string) {
		return this.runTick(authorization);
	}

	@Post("internal/sequences/tick")
	@AllowAnonymous()
	async tickViaPost(@Headers("authorization") authorization?: string) {
		return this.runTick(authorization);
	}

	@Get("t/open/:token")
	@AllowAnonymous()
	async open(
		@Param("token") token: string,
		@Res() res: Response,
	): Promise<void> {
		await this.tick.recordOpen(token);
		res.setHeader("Content-Type", "image/gif");
		res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
		res.status(200).send(PIXEL_GIF);
	}

	@Get("t/click/:token")
	@AllowAnonymous()
	async click(
		@Param("token") token: string,
		@Query("u") destination: string | undefined,
		@Res() res: Response,
	): Promise<void> {
		await this.tick.recordClick(token);
		const target = safeHttpUrl(destination) ?? "/";
		res.redirect(302, target);
	}

	@Get("u/:token")
	@AllowAnonymous()
	async unsubscribe(
		@Param("token") token: string,
		@Res() res: Response,
	): Promise<void> {
		const result = await this.tick.unsubscribe(token);
		const message = result.ok
			? "You have been unsubscribed from these emails."
			: "This unsubscribe link is not valid.";
		res
			.status(200)
			.type("html")
			.send(
				`<!doctype html><html><head><meta charset="utf-8"><title>Unsubscribe</title></head><body style="font-family:system-ui;padding:2rem;"><p>${message}</p></body></html>`,
			);
	}

	private async runTick(authorization?: string) {
		if (!this.secret) {
			this.logger.error({
				message:
					"CRON_SECRET is not set — refusing to run the sequences tick.",
			});
			throw new ServiceUnavailableException("Sequences tick is not configured.");
		}

		if (!timingSafeEquals(authorization ?? "", `Bearer ${this.secret}`)) {
			throw new ForbiddenException();
		}

		return this.tick.runDue();
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

/** Only allow http(s) redirects — never open redirects to javascript: etc. */
function safeHttpUrl(value: string | undefined): string | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		return url.toString();
	} catch {
		return null;
	}
}
