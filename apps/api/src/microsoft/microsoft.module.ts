import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { CompaniesModule } from "../companies/companies.module";
import { GoogleModule } from "../google/google.module";
import { TrpcModule } from "../trpc/trpc.module";
import { ConversationService } from "./conversation.service";
import { GraphApiClient } from "./graph-api.client";
import { MicrosoftRouter } from "./microsoft.router";
import { MicrosoftConnectionService } from "./microsoft-connection.service";
import { MicrosoftMatchService } from "./microsoft-match.service";
import { MicrosoftSyncController } from "./microsoft-sync.controller";
import { MicrosoftSyncService } from "./microsoft-sync.service";
import { MicrosoftTokenService } from "./microsoft-token.service";
import { OutlookCalendarClient } from "./outlook-calendar.client";
import { OutlookCalendarSyncService } from "./outlook-calendar-sync.service";
import { OutlookMailClient } from "./outlook-mail.client";
import { OutlookMailSyncService } from "./outlook-mail-sync.service";

/**
 * Outlook mail and calendar.
 *
 * The twin of `GoogleModule`. Imports `GoogleModule` for the shared
 * `SyncStateService` — the cursor store is provider-agnostic and lives there —
 * and `CompaniesModule` / `AgentModule` for the same reasons Google does.
 * `ActivityStampService` and `EnrichmentLogService` come from the global
 * `CrmModule`. Every piece of intelligence stays in the agent, not here.
 */
@Module({
	// GoogleModule for SyncStateService.
	imports: [TrpcModule, AgentModule, CompaniesModule, GoogleModule],
	controllers: [MicrosoftSyncController],
	providers: [
		GraphApiClient,
		MicrosoftTokenService,
		MicrosoftMatchService,
		OutlookCalendarClient,
		OutlookCalendarSyncService,
		OutlookMailClient,
		OutlookMailSyncService,
		MicrosoftSyncService,
		MicrosoftConnectionService,
		ConversationService,
		MicrosoftRouter,
	],
	exports: [MicrosoftSyncService, MicrosoftConnectionService],
})
export class MicrosoftModule {}
