import {
	assignRep,
	type Db,
	inferGeoFromForm,
	loadSalesTerritory,
} from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../config/env.validation";
import { InjectDatabase } from "../database/database.constants";
import { workDomain } from "../google/participants";
import {
	GraphApiClient,
	type GraphResult,
} from "../microsoft/graph-api.client";
import { MicrosoftAppTokenService } from "../microsoft/microsoft-app-token.service";
import type { GraphMessage } from "../microsoft/outlook-mail.client";
import {
	isCustomerQuestionSubject,
	parseCustomerQuestionBody,
} from "./webform-parse";

const GRAPH = "https://graph.microsoft.com/v1.0";
const PAGE_SIZE = 25;
const MAX_PAGES = 8;

type MessagePage = {
	value?: GraphMessage[];
	"@odata.nextLink"?: string;
};

/**
 * Poll the shared webform mailbox for "Customer Question" messages.
 *
 * Mechanical: Graph fetch → parse → territory assign → PendingWebLead.
 * Capability is off when WEBFORM_MAILBOX is unset or app-only auth is missing.
 */
@Injectable()
export class WebformIngestService {
	private readonly logger = new Logger(WebformIngestService.name);
	private readonly mailbox: string | undefined;

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly config: ConfigService<EnvironmentVariables, true>,
		private readonly appToken: MicrosoftAppTokenService,
		private readonly graph: GraphApiClient,
	) {
		const raw = this.config.get("WEBFORM_MAILBOX", { infer: true });
		this.mailbox = raw?.trim().toLowerCase() || undefined;
	}

	isEnabled(): boolean {
		return Boolean(this.mailbox) && this.appToken.isConfigured();
	}

	async run(): Promise<{
		skipped: boolean;
		reason?: string;
		scanned: number;
		created: number;
		skippedDuplicate: number;
		parseFailed: number;
	}> {
		if (!this.mailbox) {
			return {
				skipped: true,
				reason: "WEBFORM_MAILBOX unset",
				scanned: 0,
				created: 0,
				skippedDuplicate: 0,
				parseFailed: 0,
			};
		}

		const token = await this.appToken.getAccessToken();
		if (!token) {
			return {
				skipped: true,
				reason: "app-only Graph token unavailable",
				scanned: 0,
				created: 0,
				skippedDuplicate: 0,
				parseFailed: 0,
			};
		}

		const sync = await this.db.webformMailboxSync.upsert({
			where: { id: "default" },
			create: { id: "default", mailbox: this.mailbox },
			update: { mailbox: this.mailbox },
		});

		const cursor = sync.cursor;
		let nextUrl: string | undefined = this.buildListUrl(cursor);
		let scanned = 0;
		let created = 0;
		let skippedDuplicate = 0;
		let parseFailed = 0;
		let highWater = cursor;
		let pages = 0;

		try {
			while (nextUrl && pages < MAX_PAGES) {
				pages += 1;
				const page: GraphResult<MessagePage> =
					await this.graph.get<MessagePage>(nextUrl, token);
				if (page.outcome !== "ok") {
					const reason =
						page.outcome === "failed"
							? page.reason
							: page.outcome === "rate-limited"
								? page.reason
								: page.outcome;
					await this.db.webformMailboxSync.update({
						where: { id: "default" },
						data: {
							lastError: reason,
							lastSyncedAt: new Date(),
						},
					});
					this.logger.warn({
						message: "Webform mailbox page failed",
						outcome: page.outcome,
						reason,
					});
					break;
				}

				const messages = page.data.value ?? [];
				for (const message of messages) {
					scanned += 1;
					const received = message.receivedDateTime;
					if (received && (!highWater || received > highWater)) {
						highWater = received;
					}

					const result = await this.ingestMessage(message);
					if (result === "created") created += 1;
					else if (result === "duplicate") skippedDuplicate += 1;
					else if (result === "parse-failed") parseFailed += 1;
				}

				nextUrl = page.data["@odata.nextLink"];
				// First tick without a cursor: only walk the first page of recent
				// mail so we do not backfill years of history. Subsequent ticks use
				// the high-water filter and may page.
				if (!cursor) break;
			}

			await this.db.webformMailboxSync.update({
				where: { id: "default" },
				data: {
					cursor: highWater ?? cursor,
					lastSyncedAt: new Date(),
					lastError: null,
				},
			});
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			await this.db.webformMailboxSync.update({
				where: { id: "default" },
				data: { lastError: reason, lastSyncedAt: new Date() },
			});
			throw error;
		}

		this.logger.log({
			message: "Webform mailbox ingest finished",
			mailbox: this.mailbox,
			scanned,
			created,
			skippedDuplicate,
			parseFailed,
		});

		return {
			skipped: false,
			scanned,
			created,
			skippedDuplicate,
			parseFailed,
		};
	}

	private buildListUrl(cursor: string | null): string {
		const address = this.mailbox;
		if (!address) {
			throw new Error("WEBFORM_MAILBOX is required to build the list URL.");
		}
		const mailbox = encodeURIComponent(address);
		const select = [
			"id",
			"internetMessageId",
			"subject",
			"receivedDateTime",
			"body",
			"bodyPreview",
		].join(",");

		const params = new URLSearchParams({
			$select: select,
			$orderby: "receivedDateTime desc",
			$top: String(PAGE_SIZE),
		});

		if (cursor) {
			// Graph datetime literals need quotes.
			params.set("$filter", `receivedDateTime gt ${cursor}`);
		}

		return `${GRAPH}/users/${mailbox}/mailFolders/inbox/messages?${params.toString()}`;
	}

	private async ingestMessage(
		message: GraphMessage,
	): Promise<"created" | "duplicate" | "parse-failed" | "skipped"> {
		if (!isCustomerQuestionSubject(message.subject)) {
			return "skipped";
		}

		const sourceMessageId =
			message.internetMessageId?.trim() || message.id?.trim();
		if (!sourceMessageId) return "parse-failed";

		const existing = await this.db.pendingWebLead.findUnique({
			where: { sourceMessageId },
			select: { id: true },
		});
		if (existing) return "duplicate";

		const bodyContent = message.body?.content ?? message.bodyPreview ?? "";
		const contentType =
			message.body?.contentType?.toLowerCase() === "text" ? "text" : "html";
		const parsed = parseCustomerQuestionBody(bodyContent, contentType);
		if (!parsed) return "parse-failed";

		const domain = workDomain(parsed.email);
		if (!domain) return "parse-failed";

		const geo = inferGeoFromForm({
			locationText: parsed.locationText,
			connectLocation: parsed.connectLocation,
			comments: parsed.comments,
		});

		let assignedUserId: string | null = null;
		try {
			const map = loadSalesTerritory();
			const assignment = assignRep(map, {
				companyName: parsed.companyName,
				stateCode: geo.stateCode,
				countryCode: geo.countryCode,
			});
			if (assignment) {
				const user = await this.db.user.findUnique({
					where: { email: assignment.email },
					select: { id: true },
				});
				assignedUserId = user?.id ?? null;
				if (!user) {
					this.logger.warn({
						message: "Territory rep has no local User",
						email: assignment.email,
						repCode: assignment.repCode,
					});
				}
			}
		} catch (error) {
			this.logger.warn({
				message: "Territory assign failed — leaving unassigned",
				error: error instanceof Error ? error.message : String(error),
			});
		}

		const receivedAt = message.receivedDateTime
			? new Date(message.receivedDateTime)
			: new Date();

		await this.db.pendingWebLead.create({
			data: {
				sourceMessageId,
				email: parsed.email,
				displayName: parsed.displayName,
				domain,
				phone: parsed.phone,
				companyName: parsed.companyName,
				locationText: parsed.locationText,
				connectLocation: parsed.connectLocation,
				comments: parsed.comments,
				sampleSubject: message.subject ?? null,
				stateCode: geo.stateCode ?? null,
				countryCode: geo.countryCode ?? null,
				assignedUserId,
				receivedAt,
				status: "PENDING",
			},
		});

		return "created";
	}
}
