import { Inject } from "@nestjs/common";
import { Ctx, Input, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import {
	dashboardCertaintyByRepInput,
	dashboardRepSummaryInput,
	dashboardSummaryInput,
} from "./dashboard.contracts";
import { DashboardService } from "./dashboard.service";

@Router({ alias: "dashboard" })
@UseMiddlewares(AuthMiddleware)
export class DashboardRouter {
	constructor(
		@Inject(DashboardService) private readonly dashboard: DashboardService,
	) {}

	/**
	 * Everything on the overview: closed-won and the rolling rates behind it, the
	 * open pipeline by stage, six months of won against created, what is due to
	 * close, the biggest open deals, overdue tasks and recent activity.
	 */
	@Query({ input: dashboardSummaryInput })
	async summary(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof dashboardSummaryInput>,
	) {
		return this.dashboard.summary(ctx.user.id, input);
	}

	/**
	 * One sales rep for the manager sheet: KPIs, certainty × month grid, open
	 * deals, owned companies, and recent field changes on their deals.
	 */
	@Query({ input: dashboardRepSummaryInput })
	async repSummary(
		@Input() input: z.infer<typeof dashboardRepSummaryInput>,
	) {
		return this.dashboard.repSummary(input);
	}

	/**
	 * Everyone overview: deal counts by owner × stage certainty band for a
	 * close-date window (open by expected close; won/lost by closedAt).
	 */
	@Query({ input: dashboardCertaintyByRepInput })
	async certaintyByRep(
		@Input() input: z.infer<typeof dashboardCertaintyByRepInput>,
	) {
		return this.dashboard.certaintyByRep(input);
	}
}
