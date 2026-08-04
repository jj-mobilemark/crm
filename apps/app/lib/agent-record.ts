import type { CarbonIcon } from "@crm/ui/components/icon";

/**
 * Which record the agent is being asked about.
 *
 * The panel appears on three sheets and the overview, and the questions worth
 * asking are different on each: a person has a job and a history, a company has
 * a market and a story, a deal has a state and a next step, and the pipeline has
 * what moved. Offering "Who is this person?" on a company is the tell that a
 * chat box was bolted on rather than built into the record.
 *
 * One shape carries it end to end — the header the panel sends, the claim the
 * proxy mints, the field the conversation is filed under, and the preamble the
 * agent opens with — so adding a kind is one entry rather than four edits in
 * four layers.
 */

export type AgentRecordKind = "contact" | "company" | "deal" | "pipeline";

/** Overview Me/Everyone — carried as the record `id` for pipeline sessions. */
export type PipelineScope = "me" | "everyone";

export type AgentRecord =
	| { kind: "contact" | "company" | "deal"; id: string }
	| { kind: "pipeline"; id: PipelineScope };

type RecordCopy = {
	/** The header the panel sends; the proxy turns it into a token claim. */
	header: string;
	/**
	 * The tRPC field a conversation is filed under.
	 * Pipeline uses `pipelineScope` (Me/Everyone), not a CRM cuid.
	 */
	field: "contactId" | "companyId" | "dealId" | "pipelineScope";
	title: string;
	blurb: string;
	placeholder: string;
	/**
	 * What this agent is actually good at, per record.
	 *
	 * Three, because a wall of chips is a menu nobody reads, and each one maps
	 * onto tools the agent has rather than to something it would have to invent.
	 */
	suggestions: string[];
};

const COPY: Record<AgentRecordKind, RecordCopy> = {
	contact: {
		header: "x-crm-contact",
		field: "contactId",
		title: "Ask about this person",
		blurb:
			"Every step is shown as it happens — including the leads it throws away.",
		placeholder: "Are they still there?",
		suggestions: [
			"Who is this person?",
			"Are they still there?",
			"What should I know before a call?",
		],
	},
	company: {
		header: "x-crm-company",
		field: "companyId",
		title: "Ask about this company",
		blurb:
			"It reads their site and our own history with them, and shows its working.",
		placeholder: "What do they sell?",
		suggestions: [
			"What do they do?",
			"Who do we know here?",
			"What has changed recently?",
		],
	},
	deal: {
		header: "x-crm-deal",
		field: "dealId",
		title: "Ask about this deal",
		blurb:
			"It can read the thread, the meetings and the people on both sides of it.",
		placeholder: "Where has this stalled?",
		suggestions: [
			"Where does this stand?",
			"Who else should be involved?",
			"What is the risk here?",
		],
	},
	pipeline: {
		header: "x-crm-pipeline",
		field: "pipelineScope",
		title: "Ask about the pipeline",
		blurb:
			"It reads deal moves and month reports — never invents totals.",
		placeholder: "What moved this week?",
		suggestions: [
			"What moved this week?",
			"Who's stuck?",
			"What's closing this month?",
		],
	},
};

export function recordCopy(kind: AgentRecordKind): RecordCopy {
	return COPY[kind];
}

/** The header a panel sends so the agent knows what it is looking at. */
export function recordHeader(record: AgentRecord): Record<string, string> {
	return { [COPY[record.kind].header]: record.id };
}

/** The shape the conversations API files a thread under. */
export function recordFilter(record: AgentRecord): {
	contactId?: string;
	companyId?: string;
	dealId?: string;
	pipelineScope?: PipelineScope;
} {
	return { [COPY[record.kind].field]: record.id };
}

export type { CarbonIcon };
