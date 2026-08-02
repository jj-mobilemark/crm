import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { CompaniesModule } from "../companies/companies.module";
import { TrpcModule } from "../trpc/trpc.module";
import { CalendarClient } from "./calendar.client";
import { CalendarSyncService } from "./calendar-sync.service";
import { ConversationService } from "./conversation.service";
import { GmailClient } from "./gmail.client";
import { GmailSyncService } from "./gmail-sync.service";
import { GoogleRouter } from "./google.router";
import { GoogleApiClient } from "./google-api.client";
import { GoogleConnectionService } from "./google-connection.service";
import { GoogleMatchService } from "./google-match.service";
import { GoogleSyncService } from "./google-sync.service";
import { GoogleTokenService } from "./google-token.service";
import { SyncController } from "./sync.controller";
import { SyncStateService } from "./sync-state.service";

/**
 * Gmail and Calendar.
 *
 * Depends on `CompaniesModule` for `companyForEmail` — turning a work address
 * into a found-or-created company — and on `AgentModule` to say that a contact
 * arrived with nothing but an address. Neither of those is enrichment: this
 * module reports what the sync saw and lets the agent decide what it means.
 */
@Module({
	imports: [TrpcModule, AgentModule, CompaniesModule],
	controllers: [SyncController],
	providers: [
		GoogleApiClient,
		GoogleTokenService,
		SyncStateService,
		GoogleMatchService,
		CalendarClient,
		CalendarSyncService,
		GmailClient,
		GmailSyncService,
		GoogleSyncService,
		GoogleConnectionService,
		ConversationService,
		GoogleRouter,
	],
	exports: [GoogleSyncService, GoogleConnectionService, SyncStateService],
})
export class GoogleModule {}
