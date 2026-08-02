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
import { ConversationService } from "./conversation.service";
import {
	msCalendarEventInput,
	msSetAutoCreateInput,
	msSuppressDomainInput,
	msThreadInput,
} from "./microsoft.contracts";
import { MicrosoftConnectionService } from "./microsoft-connection.service";
import { MicrosoftSyncService } from "./microsoft-sync.service";

/**
 * The Microsoft integration's data surface.
 *
 * The twin of `GoogleRouter`. Connecting is absent on purpose: the browser
 * calls `authClient.linkSocial()` directly, and `status` reads the result off
 * the granted scopes. A procedure here would only be a second way to describe
 * the same grant.
 */
@Router({ alias: "microsoft" })
@UseMiddlewares(AuthMiddleware)
export class MicrosoftRouter {
	constructor(
		@Inject(MicrosoftConnectionService)
		private readonly connection: MicrosoftConnectionService,
		@Inject(MicrosoftSyncService) private readonly sync: MicrosoftSyncService,
		@Inject(ConversationService)
		private readonly conversations: ConversationService,
	) {}

	@Query()
	async status(@Ctx() ctx: AuthedTrpcContext) {
		return this.connection.status(ctx.user.id);
	}

	/**
	 * Deletes what this mailbox put into the CRM and re-imports it.
	 *
	 * Not a disconnect: syncing is a condition of having an account, so there is
	 * no state where a signed-in rep is not syncing. `revokeAccess` is the exit.
	 */
	@Mutation()
	async purgeSyncedData(@Ctx() ctx: AuthedTrpcContext) {
		return this.connection.purgeSyncedData(ctx.user.id);
	}

	/** Clears the Microsoft tokens and removes the Outlook sync rows. */
	@Mutation()
	async revokeAccess(@Ctx() ctx: AuthedTrpcContext) {
		return this.connection.revoke(ctx.user.id);
	}

	@Mutation()
	async syncNow(@Ctx() ctx: AuthedTrpcContext) {
		await this.sync.runForUser(ctx.user.id);
		return this.connection.status(ctx.user.id);
	}

	@Mutation({ input: msSetAutoCreateInput })
	async setAutoCreate(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof msSetAutoCreateInput>,
	) {
		await this.connection.setAutoCreate(
			ctx.user.id,
			input.source,
			input.enabled,
		);
		return this.connection.status(ctx.user.id);
	}

	@Mutation({ input: msSuppressDomainInput })
	async suppressDomain(@Input() input: z.infer<typeof msSuppressDomainInput>) {
		return this.connection.suppressDomain(input.domain, {
			reason: input.reason,
			purge: input.purge,
		});
	}

	/** The messages behind a timeline entry. Only called when one is expanded. */
	@Query({ input: msThreadInput })
	async thread(@Input("threadId") threadId: string) {
		return this.conversations.thread(threadId);
	}

	@Query({ input: msCalendarEventInput })
	async event(@Input("eventId") eventId: string) {
		return this.conversations.event(eventId);
	}
}
