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
	dealCreateInput,
	dealIdInput,
	dealListInput,
	dealUpdateArgs,
	setStageInput,
} from "./deals.contracts";
import { DealsService } from "./deals.service";

@Router({ alias: "deals" })
@UseMiddlewares(AuthMiddleware)
export class DealsRouter {
	constructor(@Inject(DealsService) private readonly deals: DealsService) {}

	@Query({ input: dealListInput })
	async list(@Input() input: z.infer<typeof dealListInput>) {
		return this.deals.list(input);
	}

	@Query({ input: dealIdInput })
	async byId(@Input("id") id: string) {
		return this.deals.byId(id);
	}

	@Mutation({ input: dealCreateInput })
	async create(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof dealCreateInput>,
	) {
		return this.deals.create(input, {
			id: ctx.user.id,
			email: ctx.user.email,
		});
	}

	@Mutation({ input: dealUpdateArgs })
	async update(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof dealUpdateArgs>,
	) {
		return this.deals.update(input.id, input.data, {
			id: ctx.user.id,
			email: ctx.user.email,
		});
	}

	/** Moves the deal and writes the `STAGE_CHANGE` activity in one transaction. */
	@Mutation({ input: setStageInput })
	async setStage(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof setStageInput>,
	) {
		return this.deals.setStage(input, {
			id: ctx.user.id,
			email: ctx.user.email,
		});
	}
}
