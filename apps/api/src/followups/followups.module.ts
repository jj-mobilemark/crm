import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { TrpcModule } from "../trpc/trpc.module";
import { FollowupsController } from "./followups.controller";
import { FollowupsRouter } from "./followups.router";
import { FollowupsService } from "./followups.service";

/**
 * The per-rep Follow-ups panel.
 *
 * `AgentModule` for `AgentTriggerService.followupsDue` — the daily cron only
 * queues the work; `apps/agent` reads mail and writes `FollowUpSuggestion`
 * rows on its own clock. Everything a rep sees or decides on lives here.
 * `ActivityStampService` comes from the global `CrmModule`.
 */
@Module({
	imports: [TrpcModule, AgentModule],
	controllers: [FollowupsController],
	providers: [FollowupsService, FollowupsRouter],
})
export class FollowupsModule {}
