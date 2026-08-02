import { Module } from "@nestjs/common";
import { SageSoapClient } from "./sage-soap.client";

/**
 * Sage CRM sync (see `docs/plans/sage-crm-sync.md`).
 *
 * Foundation only for now: the SOAP client. The pull service, the test-slice
 * import route, and the id-surfacing UI are the next steps. Reads config via the
 * global `ConfigModule`; a missing `SAGE_SOAP_*` leaves the client unconfigured
 * rather than throwing, so the feature is simply absent on a self-host that has
 * no Sage. Every piece of intelligence stays in the agent, not here — this
 * module only fetches and maps records.
 */
@Module({
	providers: [SageSoapClient],
	exports: [SageSoapClient],
})
export class SageModule {}
