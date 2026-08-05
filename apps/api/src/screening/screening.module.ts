import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { GraphApiClient } from "../microsoft/graph-api.client";
import { MicrosoftAppTokenService } from "../microsoft/microsoft-app-token.service";
import { TrpcModule } from "../trpc/trpc.module";
import { ScreeningRouter } from "./screening.router";
import { ScreeningService } from "./screening.service";
import { ScreeningHarvestService } from "./screening-harvest.service";
import { WebformIngestService } from "./webform-ingest.service";
import { WebformSyncController } from "./webform-sync.controller";

/**
 * Screening Room — pending unmatched correspondents from Outlook sync, plus
 * website form leads from the shared info@ mailbox.
 *
 * Harvest is exported so Microsoft mail sync can upsert without storing bodies.
 * Decide lives here and creates contacts through ContactsModule.
 */
@Module({
	imports: [TrpcModule, ContactsModule],
	controllers: [WebformSyncController],
	providers: [
		ScreeningHarvestService,
		ScreeningService,
		ScreeningRouter,
		GraphApiClient,
		MicrosoftAppTokenService,
		WebformIngestService,
	],
	exports: [ScreeningHarvestService],
})
export class ScreeningModule {}
