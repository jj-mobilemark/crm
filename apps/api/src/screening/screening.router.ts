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
import { screeningDecideInput } from "./screening.contracts";
import { ScreeningService } from "./screening.service";

@Router({ alias: "screening" })
@UseMiddlewares(AuthMiddleware)
export class ScreeningRouter {
	constructor(
		@Inject(ScreeningService) private readonly screening: ScreeningService,
	) {}

	@Query()
	async list(@Ctx() ctx: AuthedTrpcContext) {
		return this.screening.list(ctx.user.id);
	}

	@Mutation({ input: screeningDecideInput })
	async decide(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof screeningDecideInput>,
	) {
		return this.screening.decide(input, ctx.user.id);
	}
}
