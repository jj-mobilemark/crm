import { defineTool } from "eve/tools";
import { z } from "zod";
import { repFollowupContext } from "../lib/followups";

/**
 * What the daily follow-up sweep reads before it proposes anything.
 *
 * Free, like every other CRM read in this agent — no vendor, no budget. Call
 * it first and only once per sweep: it returns the rep's recent synced mail
 * (with real message and thread ids) and their open deals in one shot, which
 * is everything `propose_followups` needs to cite.
 */
export default defineTool({
	description:
		"Read a rep's recent synced mail (with message ids, threads, and bodies) and their open deals (stage, how long each has been quiet). Call this once at the start of a follow-up sweep, before proposing anything.",
	inputSchema: z.object({
		userId: z.string(),
		messages: z
			.number()
			.int()
			.min(1)
			.max(100)
			.default(40)
			.describe("How many recent messages from this rep's mailbox to read."),
	}),
	async execute({ userId, messages }) {
		const context = await repFollowupContext(userId, { messages });
		if (!context) return { found: false as const, reason: "No such user." };

		return {
			found: true as const,
			...context,
			note:
				context.messages.length === 0
					? "No synced mail yet — there is nothing to base a suggestion on."
					: "Cite the exact `id` of a message as `messageId` and its `threadId` in `propose_followups`. Never invent one.",
		};
	},
});
