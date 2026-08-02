import { defineTool } from "eve/tools";
import { z } from "zod";
import { proposeFollowUp } from "../lib/followups";

const KINDS = ["commitment", "reply-owed", "deal-risk", "next-step"] as const;

/**
 * Records one follow-up a rep should see — never a batch, never a guess.
 *
 * Called once per suggestion, the same way `record_fact` records one claim at
 * a time: a single-purpose write is what makes each one checkable against
 * what it cites. `evidence` is verified against real message ids before
 * anything is written — see `proposeFollowUp` — so a suggestion that names a
 * message nobody can find fails here instead of reaching a rep's screen.
 */
export default defineTool({
	description:
		"Record one follow-up suggestion for a rep, grounded in real messages from read_rep_followup_context. Call once per suggestion. Every suggestion must name at least one real message id it came from — never invent one.",
	inputSchema: z.object({
		userId: z.string(),
		contactId: z.string().optional(),
		companyId: z.string().optional(),
		dealId: z.string().optional(),
		kind: z
			.enum(KINDS)
			.describe(
				"commitment: something the rep said they'd do. reply-owed: an inbound question never answered. deal-risk: a deal gone quiet. next-step: an agreed step nobody booked.",
			),
		summary: z
			.string()
			.trim()
			.min(1)
			.max(200)
			.describe('One sentence, imperative — "Send Acme the revised quote".'),
		quote: z
			.string()
			.trim()
			.max(300)
			.optional()
			.describe("A short excerpt from the cited message. Never a full body."),
		dueHint: z
			.string()
			.optional()
			.describe("ISO-8601 date, only if the evidence implies one."),
		evidence: z
			.array(
				z.object({
					threadId: z.string(),
					messageId: z.string(),
					sentAt: z.string(),
				}),
			)
			.min(1)
			.describe("Real ids from read_rep_followup_context. At least one."),
	}),
	async execute(input) {
		const result = await proposeFollowUp(input);
		return result;
	},
});
