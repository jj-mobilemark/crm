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
	tripPlanCandidatesInput,
	tripPlanCreateInput,
	tripPlanIdInput,
	tripPlanUpdateInput,
} from "./trip-plans.contracts";
import { TripPlansService } from "./trip-plans.service";

@Router({ alias: "tripPlans" })
@UseMiddlewares(AuthMiddleware)
export class TripPlansRouter {
	constructor(
		@Inject(TripPlansService) private readonly tripPlans: TripPlansService,
	) {}

	@Query()
	async list(@Ctx() ctx: AuthedTrpcContext) {
		return this.tripPlans.list(ctx.user.id);
	}

	@Query({ input: tripPlanIdInput })
	async get(@Ctx() ctx: AuthedTrpcContext, @Input("id") id: string) {
		return this.tripPlans.get(id, ctx.user.id);
	}

	@Mutation({ input: tripPlanCreateInput })
	async create(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof tripPlanCreateInput>,
	) {
		return this.tripPlans.create(input, ctx.user.id);
	}

	@Mutation({ input: tripPlanUpdateInput })
	async update(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof tripPlanUpdateInput>,
	) {
		return this.tripPlans.update(input, ctx.user.id);
	}

	@Mutation({ input: tripPlanIdInput })
	async delete(@Ctx() ctx: AuthedTrpcContext, @Input("id") id: string) {
		return this.tripPlans.remove(id, ctx.user.id);
	}

	@Query({ input: tripPlanCandidatesInput })
	async candidates(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof tripPlanCandidatesInput>,
	) {
		return this.tripPlans.candidates(input.id, ctx.user.id, input.limit);
	}
}
