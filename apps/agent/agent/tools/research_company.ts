import { ActivityType, db } from "@crm/db";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { enabled } from "../lib/capabilities";
import { extract } from "../lib/context-dev";
import { spend } from "../lib/focus";
import { ask } from "../lib/perplexity";

/** The shape the brief is extracted into. */
const RESEARCH_SCHEMA = {
	type: "object",
	properties: {
		positioning: {
			type: "string",
			description: "One paragraph: what they sell and who to.",
		},
		pricingModel: {
			type: "string",
			description: "How they charge — per seat, usage, flat, enterprise-only.",
		},
		targetCustomer: {
			type: "string",
			description: "The customer they describe themselves as serving.",
		},
		notableCustomers: {
			type: "array",
			items: { type: "string" },
			description: "Named customers or logos on the site.",
		},
		recentNews: {
			type: "array",
			items: { type: "string" },
			description: "Recent announcements, funding, or launches.",
		},
	},
	required: ["positioning"],
} as const;

const RESEARCH_INSTRUCTIONS =
	"Read this company's marketing site and answer as a salesperson preparing " +
	"for a first call. Be specific and factual; leave a field empty rather than " +
	"guessing.";

/**
 * Writes a research brief to a company's timeline.
 *
 * Prefers reading the company's own site (Context.dev extract) when we have a
 * URL. When Sage left no website/domain — common for note-filled Sage
 * `website` fields — falls back to Perplexity by company name so Research
 * still works on installs that have `PERPLEXITY_API_KEY`.
 */
export default defineTool({
	description:
		"Read a company's marketing site (or open-web sources when there is no site) and write a research brief to its timeline: positioning, pricing, who they sell to, notable customers, recent news.",
	inputSchema: z.object({
		companyId: z.string(),
	}),
	async execute({ companyId }) {
		const company = await db.company.findUnique({
			where: { id: companyId },
			select: {
				id: true,
				name: true,
				domain: true,
				website: true,
				ownerId: true,
			},
		});

		if (!company)
			return { written: false as const, reason: "No such company." };

		const url =
			company.website ?? (company.domain ? `https://${company.domain}` : null);

		const author =
			company.ownerId ??
			(await db.user.findFirst({ select: { id: true } }))?.id ??
			null;

		if (!author)
			return { written: false as const, reason: "No user to attribute to." };

		if (url) {
			const charge = spend(2);
			if (!charge.ok) return { written: false as const, reason: charge.reason };

			const result = await extract(
				url,
				RESEARCH_SCHEMA as unknown as Record<string, unknown>,
				RESEARCH_INSTRUCTIONS,
			);

			if (result.outcome === "failed") {
				return { written: false as const, reason: result.reason };
			}

			return writeBrief({
				companyId: company.id,
				companyName: company.name,
				authorId: author,
				body: formatBrief(result.data),
				meta: {
					source: "context.dev",
					endpoint: "web/extract",
					creditCost: 10,
					agent: "people-research",
				},
			});
		}

		if (!enabled("PERPLEXITY_API_KEY")) {
			return {
				written: false as const,
				reason:
					"This company has no website or domain, and PERPLEXITY_API_KEY is not set.",
			};
		}

		const charge = spend(2);
		if (!charge.ok) return { written: false as const, reason: charge.reason };

		const answer = await ask(
			`Prepare a B2B sales brief on the company "${company.name}". Cover: what they sell and who to; how they price if public; notable customers; recent news or announcements. Be specific and factual. Leave gaps rather than guessing.`,
			{
				model: "sonar-pro",
				system:
					"You are researching for a B2B sales rep preparing for a first call. " +
					"State only what your sources support. Prefer recent information. " +
					"Never invent customers, pricing, or news.",
			},
		);

		if (!answer.ok) {
			return { written: false as const, reason: answer.reason };
		}

		const citations =
			answer.data.citations.length > 0
				? `\n\nSources:\n${answer.data.citations.map((c) => `• ${c}`).join("\n")}`
				: "";

		return writeBrief({
			companyId: company.id,
			companyName: company.name,
			authorId: author,
			body: `${answer.data.text.trim()}${citations}`,
			meta: {
				source: "perplexity",
				endpoint: "chat/completions",
				model: "sonar-pro",
				agent: "people-research",
			},
		});
	},
});

async function writeBrief(input: {
	companyId: string;
	companyName: string;
	authorId: string;
	body: string;
	meta: Record<string, unknown>;
}) {
	const activity = await db.activity.create({
		data: {
			type: ActivityType.ENRICHMENT,
			subject: `Research brief — ${input.companyName}`,
			body: input.body,
			occurredAt: new Date(),
			companyId: input.companyId,
			createdById: input.authorId,
			meta: input.meta,
		},
		select: { id: true },
	});

	await db.company.update({
		where: { id: input.companyId },
		data: { lastActivityAt: new Date() },
	});

	return { written: true as const, activityId: activity.id };
}

function formatBrief(data: unknown): string {
	if (typeof data !== "object" || data === null) return String(data ?? "");

	const brief = data as {
		positioning?: unknown;
		pricingModel?: unknown;
		targetCustomer?: unknown;
		notableCustomers?: unknown;
		recentNews?: unknown;
	};

	const lines: string[] = [];
	const text = (value: unknown) =>
		typeof value === "string" && value.trim() ? value.trim() : null;
	const list = (value: unknown) =>
		Array.isArray(value)
			? value.filter((item): item is string => typeof item === "string")
			: [];

	const positioning = text(brief.positioning);
	if (positioning) lines.push(positioning);

	const pricing = text(brief.pricingModel);
	if (pricing) lines.push(`Pricing: ${pricing}`);

	const target = text(brief.targetCustomer);
	if (target) lines.push(`Sells to: ${target}`);

	const customers = list(brief.notableCustomers);
	if (customers.length > 0) lines.push(`Customers: ${customers.join(", ")}`);

	const news = list(brief.recentNews);
	if (news.length > 0) {
		lines.push(`Recently:\n${news.map((item) => `• ${item}`).join("\n")}`);
	}

	return lines.join("\n\n");
}
