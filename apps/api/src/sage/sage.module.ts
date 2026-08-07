import { Module } from "@nestjs/common";
import { CompanyResolveService } from "./company-resolve.service";
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
 * External read endpoints (`order-defaults`, `resolve`) use the same Sage-
 * pulled rows — no SOAP at request time.
 */
@Module({
	controllers: [SageSyncController, OrderDefaultsController],
	providers: [
		SageSoapClient,
		SagePullService,
		SagePushService,
		OrderDefaultsService,
		CompanyResolveService,
	],
	exports: [SageSoapClient, SagePullService, SagePushService],
})
export class SageModule {}
