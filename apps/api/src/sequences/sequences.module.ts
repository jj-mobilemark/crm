import { Module } from "@nestjs/common";
import { MicrosoftModule } from "../microsoft/microsoft.module";
import { TrpcModule } from "../trpc/trpc.module";
import { SequenceTickService } from "./sequence-tick.service";
import { SequencesController } from "./sequences.controller";
import { SequencesRouter } from "./sequences.router";
import { SequencesService } from "./sequences.service";

/**
 * Email sequences — multi-step outbound cadences via Microsoft Graph.
 *
 * Mechanical only: Nest owns the tick, Graph sends from each rep's mailbox,
 * mail sync detects replies. Intelligence stays in the agent.
 */
@Module({
	imports: [TrpcModule, MicrosoftModule],
	controllers: [SequencesController],
	providers: [SequencesService, SequenceTickService, SequencesRouter],
})
export class SequencesModule {}
