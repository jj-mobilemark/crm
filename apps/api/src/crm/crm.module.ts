import { Global, Module } from "@nestjs/common";
import { ActivityStampService } from "./activity-stamp.service";
import { DealChangeRecorder } from "./deal-change.service";
import { EnrichmentLogService } from "./enrichment-log.service";

/**
 * Cross-cutting CRM concerns.
 *
 * `@Global()` for the same reason `DatabaseModule` is: every module that writes
 * an activity needs the stamp, and threading it through four `imports` arrays
 * would make the dependency graph say something about layering that is not
 * true — the composer, deals, enrichment and both Google syncs are peers.
 */
@Global()
@Module({
	providers: [ActivityStampService, EnrichmentLogService, DealChangeRecorder],
	exports: [ActivityStampService, EnrichmentLogService, DealChangeRecorder],
})
export class CrmModule {}
