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
	enrollmentIdInput,
	enrollmentListInput,
	sequenceCreateInput,
	sequenceEnrollInput,
	sequenceIdInput,
	sequenceReplaceStepsInput,
	sequenceUpdateInput,
} from "./sequences.contracts";
import { SequencesService } from "./sequences.service";

@Router({ alias: "sequences" })
@UseMiddlewares(AuthMiddleware)
export class SequencesRouter {
	constructor(
		@Inject(SequencesService) private readonly sequences: SequencesService,
	) {}

	@Query()
	async list() {
		return this.sequences.list();
	}

	@Query({ input: sequenceIdInput })
	async byId(@Input("id") id: string) {
		return this.sequences.byId(id);
	}

	@Query()
	async canSend(@Ctx() ctx: AuthedTrpcContext) {
		return { canSend: await this.sequences.canSend(ctx.user.id) };
	}

	@Query({ input: enrollmentListInput })
	async enrollments(@Input() input: z.infer<typeof enrollmentListInput>) {
		return this.sequences.listEnrollments(input);
	}

	@Mutation({ input: sequenceCreateInput })
	async create(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof sequenceCreateInput>,
	) {
		return this.sequences.create(input, ctx.user.id);
	}

	@Mutation({ input: sequenceUpdateInput })
	async update(@Input() input: z.infer<typeof sequenceUpdateInput>) {
		return this.sequences.update(input);
	}

	@Mutation({ input: sequenceReplaceStepsInput })
	async replaceSteps(
		@Input() input: z.infer<typeof sequenceReplaceStepsInput>,
	) {
		return this.sequences.replaceSteps(input);
	}

	@Mutation({ input: sequenceEnrollInput })
	async enroll(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof sequenceEnrollInput>,
	) {
		return this.sequences.enroll(input, ctx.user.id);
	}

	@Mutation({ input: enrollmentIdInput })
	async pauseEnrollment(@Input("id") id: string) {
		return this.sequences.pauseEnrollment(id);
	}

	@Mutation({ input: enrollmentIdInput })
	async resumeEnrollment(@Input("id") id: string) {
		return this.sequences.resumeEnrollment(id);
	}

	@Mutation({ input: enrollmentIdInput })
	async stopEnrollment(@Input("id") id: string) {
		return this.sequences.stopEnrollment(id);
	}
}
