import { Module } from "@nestjs/common";
import { SagePullService } from "./sage-pull.service";
import { SageSoapClient } from "./sage-soap.client";
import { SageSyncController } from "./sage-sync.controller";

/**
 * Sage CRM sync (see `docs/plans/sage-crm-sync.md`).
 *
 * Pull is mechanical: SOAP -> map -> Prisma. Intelligence stays in the agent.
 * A missing `SAGE_SOAP_*` leaves the client unconfigured rather than throwing,
 * so the feature is simply absent on a self-host that has no Sage.
 */
@Module({
	controllers: [SageSyncController],
	providers: [SageSoapClient, SagePullService],
	exports: [SageSoapClient, SagePullService],
})
export class SageModule {}
