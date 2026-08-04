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
import { followupDecideInput, followupPrefsInput } from "./followups.contracts";
import { FollowupsService } from "./followups.service";

@Router({ alias: "followups" })
@UseMiddlewares(AuthMiddleware)
export class FollowupsRouter {
	constructor(
		@Inject(FollowupsService) private readonly followups: FollowupsService,
	) {}

	@Query()
	async list(@Ctx() ctx: AuthedTrpcContext) {
		return this.followups.list(ctx.user.id);
	}

	@Query()
	async count(@Ctx() ctx: AuthedTrpcContext) {
		return this.followups.count(ctx.user.id);
	}

	@Query()
	async prefs(@Ctx() ctx: AuthedTrpcContext) {
		return this.followups.prefs(ctx.user.id);
	}

	@Query()
	async pipeline(@Ctx() ctx: AuthedTrpcContext) {
		return this.followups.pipeline(ctx.user.id);
	}

	@Mutation({ input: followupPrefsInput })
	async updatePrefs(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof followupPrefsInput>,
	) {
		return this.followups.updatePrefs(ctx.user.id, input);
	}

	@Mutation({ input: followupDecideInput })
	async decide(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof followupDecideInput>,
	) {
		return this.followups.decide(input, ctx.user.id);
	}
}
