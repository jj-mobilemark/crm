import {
	BadRequestException,
	Controller,
	ForbiddenException,
	Get,
	Headers,
	NotFoundException,
	Param,
	Query,
	ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { EnvironmentVariables } from "../config/env.validation";
import { OrderDefaultsService } from "./order-defaults.service";

/**
 * Read-only order-defaults lookup for external callers — currently the
 * doc-scanner / PO-processing sister app, which cannot fill `attention`,
 * `phone`, `email`, and `rep` from its own quoting data. Returns exactly what
 * this CRM's Sage pull already has; a field that is not in the CRM comes back
 * `null`, never guessed. See `docs/plans/sage-crm-sync.md` §7.
 *
 * `X-API-Key` guard (`CRM_API_KEY`), same shape as the quoting app's own
 * endpoints — not the `CRON_SECRET` Bearer guard other `/internal/*` routes
 * use, since this is a different caller with a different scope.
 */
@Controller("company")
export class OrderDefaultsController {
	private readonly apiKey: string | undefined;

	constructor(
		private readonly orderDefaults: OrderDefaultsService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.apiKey = config.get("CRM_API_KEY", { infer: true });
	}

	@Get(":masCustomerNo/order-defaults")
	@AllowAnonymous()
	async byMasCustomerNo(
		@Param("masCustomerNo") masCustomerNo: string,
		@Headers("x-api-key") apiKey?: string,
	) {
		this.checkApiKey(apiKey);

		const result = await this.orderDefaults.byMasCustomerNo(masCustomerNo);
		if (!result) {
			throw new NotFoundException(
				`No company with MAS customer number "${masCustomerNo}".`,
			);
		}
		return result;
	}

	/** Fallback for callers with no MAS customer number yet. */
	@Get("order-defaults")
	@AllowAnonymous()
	async byNameAndZip(
		@Query("name") name?: string,
		@Query("zip") zip?: string,
		@Headers("x-api-key") apiKey?: string,
	) {
		this.checkApiKey(apiKey);

		if (!name?.trim() || !zip?.trim()) {
			throw new BadRequestException(
				"Provide both ?name= and ?zip= for the name+ZIP fallback lookup.",
			);
		}

		const result = await this.orderDefaults.byNameAndZip(name, zip);
		if (!result) {
			throw new NotFoundException(
				`No company matching name "${name}" and ZIP "${zip}".`,
			);
		}
		return result;
	}

	private checkApiKey(apiKey?: string): void {
		if (!this.apiKey) {
			throw new ServiceUnavailableException("CRM_API_KEY is not configured.");
		}
		if (!timingSafeEquals(apiKey ?? "", this.apiKey)) {
			throw new ForbiddenException();
		}
	}
}

/**
 * Constant-time string comparison — a `===` on a shared secret leaks its
 * prefix through response timing. Same helper as the `/internal/sync/*`
 * controllers; kept local rather than shared, matching that convention.
 */
function timingSafeEquals(a: string, b: string): boolean {
	if (a.length !== b.length) return false;

	let mismatch = 0;
	for (let index = 0; index < a.length; index += 1) {
		mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
	}

	return mismatch === 0;
}
