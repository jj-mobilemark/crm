import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { TrpcModule } from "../trpc/trpc.module";
import { ScreeningRouter } from "./screening.router";
import { ScreeningService } from "./screening.service";
import { ScreeningHarvestService } from "./screening-harvest.service";

/**
 * Screening Room — pending unmatched correspondents from Outlook sync.
 *
 * Harvest is exported so Microsoft mail sync can upsert without storing bodies.
 * Decide lives here and creates contacts through ContactsModule.
 */
@Module({
	imports: [TrpcModule, ContactsModule],
	providers: [ScreeningHarvestService, ScreeningService, ScreeningRouter],
	exports: [ScreeningHarvestService],
})
export class ScreeningModule {}
