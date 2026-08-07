import {
	BadRequestException,
	Body,
	Controller,
	Get,
	Headers,
	NotFoundException,
	Param,
	Post,
	Query,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import { z } from "zod";
import type { EnvironmentVariables } from "../config/env.validation";
import {
	CompanyResolveService,
	type ResolveOptions,
	type ResolveSignals,
} from "./company-resolve.service";
import { assertCrmApiKey } from "./crm-api-key";
import { OrderDefaultsService } from "./order-defaults.service";

const resolveBodySchema = z.object({
	signals: z
		.object({
			mas_customer_no: z.string().nullish(),
			buyer_name: z.string().nullish(),
			buyer_address: z.string().nullish(),
			buyer_zip: z.string().nullish(),
			bill_to_name: z.string().nullish(),
			bill_to_address: z.string().nullish(),
			bill_to_zip: z.string().nullish(),
			ship_to_name: z.string().nullish(),
			ship_to_address: z.string().nullish(),
			ship_to_zip: z.string().nullish(),
			email: z.string().nullish(),
			email_domain: z.string().nullish(),
			phone: z.string().nullish(),
			filename_cust_no: z.string().nullish(),
		})
		.default({}),
	options: z
		.object({
			limit: z.number().int().min(1).max(20).optional(),
			require_mas_customer_no: z.boolean().optional(),
			allow_ship_to_as_account: z.boolean().optional(),
		})
		.optional(),
});

/**
 * External company lookup for the PO-processing sister app.
 *
 * - `GET …/order-defaults` — stamp defaults once a MAS # (or name+ZIP) is known
 * - `POST /company/resolve` — ranked resolve from weak labeled signals
 *   (letterhead / buyer / email) when Bill-To is missing on the page
 *
 * Auth: `X-API-Key` → `CRM_API_KEY`. See `docs/plans/sage-crm-sync.md` §7.
 */
@Controller("company")
export class OrderDefaultsController {
	private readonly apiKey: string | undefined;

	constructor(
		private readonly orderDefaults: OrderDefaultsService,
		private readonly resolveService: CompanyResolveService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.apiKey = config.get("CRM_API_KEY", { infer: true });
	}

	@Post("resolve")
	@AllowAnonymous()
	async resolve(@Body() body: unknown, @Headers("x-api-key") apiKey?: string) {
		assertCrmApiKey(this.apiKey, apiKey);

		const parsed = resolveBodySchema.safeParse(body ?? {});
		if (!parsed.success) {
			throw new BadRequestException(
				parsed.error.issues.map((i) => i.message).join("; ") ||
					"Invalid resolve body.",
			);
		}

		const signals = parsed.data.signals as ResolveSignals;
		const options = (parsed.data.options ?? {}) as ResolveOptions;
		return this.resolveService.resolve(signals, options);
	}

	/**
	 * Soft lookup when MAS # is not yet known.
	 *
	 * Declared before `:masCustomerNo/order-defaults` so Nest does not treat
	 * the literal path segment `order-defaults` as a MAS number.
	 *
	 * - `?name=&zip=` — exact name+ZIP (single order-defaults row, or 404)
	 * - `?name=` alone, `?email_domain=`, or `?phone=` — ranked candidates
	 *   via the same resolve engine (never 400 for a single soft signal)
	 */
	@Get("order-defaults")
	@AllowAnonymous()
	async bySoftLookup(
		@Query("name") name?: string,
		@Query("zip") zip?: string,
		@Query("email_domain") emailDomain?: string,
		@Query("phone") phone?: string,
		@Query("limit") limitRaw?: string,
		@Headers("x-api-key") apiKey?: string,
	) {
		assertCrmApiKey(this.apiKey, apiKey);

		const hasName = Boolean(name?.trim());
		const hasZip = Boolean(zip?.trim());
		const hasDomain = Boolean(emailDomain?.trim());
		const hasPhone = Boolean(phone?.trim());

		if (hasName && hasZip && !hasDomain && !hasPhone) {
			const exactName = name?.trim() ?? "";
			const exactZip = zip?.trim() ?? "";
			const result = await this.orderDefaults.byNameAndZip(exactName, exactZip);
			if (!result) {
				throw new NotFoundException(
					`No company matching name "${exactName}" and ZIP "${exactZip}".`,
				);
			}
			return result;
		}

		if (!hasName && !hasDomain && !hasPhone) {
			throw new BadRequestException(
				"Provide ?name=&zip= (exact), or at least one of ?name=, ?email_domain=, ?phone=.",
			);
		}

		const limit = limitRaw ? Number(limitRaw) : undefined;
		return this.resolveService.softLookup({
			name: name?.trim(),
			zip: zip?.trim(),
			emailDomain: emailDomain?.trim(),
			phone: phone?.trim(),
			limit: Number.isFinite(limit) ? limit : undefined,
		});
	}

	@Get(":masCustomerNo/order-defaults")
	@AllowAnonymous()
	async byMasCustomerNo(
		@Param("masCustomerNo") masCustomerNo: string,
		@Headers("x-api-key") apiKey?: string,
	) {
		assertCrmApiKey(this.apiKey, apiKey);

		const result = await this.orderDefaults.byMasCustomerNo(masCustomerNo);
		if (!result) {
			throw new NotFoundException(
				`No company with MAS customer number "${masCustomerNo}".`,
			);
		}
		return result;
	}
}
