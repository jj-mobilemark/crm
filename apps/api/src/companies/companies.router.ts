import { Inject } from "@nestjs/common";
import {
	Ctx,
	Input,
	Mutation,
	Query,
	Router,
	UseMiddlewares,
} from "nestjs-trpc";
import type { z } from "zod";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import {
	companyCreateInput,
	companyIdInput,
	companyByIdsInput,
	companyListInput,
	companyMapListInput,
	companyNearHubInput,
	companyOptionsInput,
	companySimilarInput,
	companyUpdateArgs,
	setPrimaryContactInput,
} from "./companies.contracts";
import { CompaniesService } from "./companies.service";

@Router({ alias: "companies" })
@UseMiddlewares(AuthMiddleware)
export class CompaniesRouter {
	constructor(
		@Inject(CompaniesService) private readonly companies: CompaniesService,
	) {}

	@Query({ input: companyListInput })
	async list(@Input() input: z.infer<typeof companyListInput>) {
		return this.companies.list(input);
	}

	@Query({ input: companyMapListInput })
	async mapList(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof companyMapListInput>,
	) {
		return this.companies.mapList(input, ctx.user.id);
	}

	@Query({ input: companyIdInput })
	async byId(@Input("id") id: string) {
		return this.companies.byId(id);
	}

	/** Labels for selected company ids (multi-picker chips). */
	@Query({ input: companyByIdsInput })
	async byIds(@Input() input: z.infer<typeof companyByIdsInput>) {
		return this.companies.byIds(input.ids);
	}

	/** Company pickers and facet labels. */
	@Query({ input: companyOptionsInput })
	async options(@Input("q") q: string) {
		return this.companies.options(q);
	}

	/** Trip Planner must-visit picker — companies near a hub. */
	@Query({ input: companyNearHubInput })
	async nearHub(@Input() input: z.infer<typeof companyNearHubInput>) {
		return this.companies.nearHub(input);
	}

	/** Soft-match before create — local CRM only, never auto-merges. */
	@Query({ input: companySimilarInput })
	async similar(@Input() input: z.infer<typeof companySimilarInput>) {
		return this.companies.similar(input);
	}

	@Mutation({ input: companyCreateInput })
	async create(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof companyCreateInput>,
	) {
		return this.companies.create(input, { id: ctx.user.id });
	}

	@Mutation({ input: companyUpdateArgs })
	async update(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof companyUpdateArgs>,
	) {
		return this.companies.update(input.id, input.data, { id: ctx.user.id });
	}

	/** Re-runs the brand lookup, ignoring Context.dev's cache. */
	@Mutation({ input: companyIdInput })
	async enrich(@Input("id") id: string) {
		return this.companies.enrich(id);
	}

	/** Reads the company's site and posts a brief to its timeline. */
	@Mutation({ input: companyIdInput })
	async research(@Ctx() ctx: AuthedTrpcContext, @Input("id") id: string) {
		return this.companies.research(id, ctx.user.id);
	}

	@Mutation({ input: setPrimaryContactInput })
	async setPrimaryContact(
		@Input() input: z.infer<typeof setPrimaryContactInput>,
	) {
		return this.companies.setPrimaryContact(input.companyId, input.contactId);
	}
}
