import { Module } from "@nestjs/common";
import { OrderDefaultsController } from "./order-defaults.controller";
import { OrderDefaultsService } from "./order-defaults.service";
import { SagePullService } from "./sage-pull.service";
import { SagePushService } from "./sage-push.service";
import { SageSoapClient } from "./sage-soap.client";
import { SageSyncController } from "./sage-sync.controller";

/**
 * Sage CRM sync (see `docs/plans/sage-crm-sync.md`).
 *
 * Pull is mechanical: SOAP -> map -> Prisma. Intelligence stays in the agent.
 * A missing `SAGE_SOAP_*` leaves the client unconfigured rather than throwing,
 * so the feature is simply absent on a self-host that has no Sage.
 *
 * `OrderDefaultsController` reads the same Sage-pulled Company/Contact rows
 * for an external caller (§7 of the plan) — no SOAP involved, so it works
 * even where `SAGE_SOAP_*` is unset, as long as the data was pulled before.
 */
@Module({
	controllers: [SageSyncController, OrderDefaultsController],
	providers: [
		SageSoapClient,
		SagePullService,
		SagePushService,
		OrderDefaultsService,
	],
	exports: [SageSoapClient, SagePullService, SagePushService],
})
export class SageModule {}
