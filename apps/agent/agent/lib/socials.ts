import type { Evidence } from "./evidence";
import {
	looksLikeSameCompany,
	nameMatchesLocalPart,
	namesMatch,
} from "./names";
import { ask } from "./perplexity";

/**
 * Finding somebody's X and GitHub accounts, and — the part that matters —
 * refusing to write one we cannot stand behind.
 *
 * The failure mode here is not "no link". It is a link to a *different real
 * person* with a similar handle, sitting on a customer record looking exactly
 * like a fact. `github.com/lewis` belongs to someone; so does `x.com/lewis`.
 * A search engine asked "what is Lewis Carhart's GitHub" will happily hand one
 * of them over, because that is what it was asked for.
 *
 * So each network is checked by whatever hard evidence that network actually
 * exposes, and the two are not equally checkable:
 *
 * - **GitHub** has a public API. We fetch the account and read its own `name`,
 *   `company` and `bio`. That is the person's own page telling us who they are,
 *   which is real corroboration.
 * - **X** has nothing readable — the profile page is a JavaScript shell to
 *   anyone without a paid API key. So the bar is the handle being a
 *   construction of their name *and* a search engine independently citing that
 *   exact profile when asked about this person by name and employer. Handles
 *   that clear neither are left empty.
 *
 * Every check in here runs against the CRM's own copy of who the contact is,
 * never against anything the model passed in — otherwise "verification" is just
 * the model marking its own homework.
 */

export type Network = "x" | "github";

export type SocialProfile = {
	network: Network;
	/** Lowercased, no leading `@`. */
	handle: string;
	/** The canonical profile URL, which is what gets written to the record. */
	url: string;
};

export type Person = {
	firstName: string;
	lastName: string | null;
	fullName: string;
	title: string | null;
	companyName: string | null;
	companyDomain: string | null;
};

/**
 * What a check found, not what it decided.
 *
 * These functions used to return `accepted: true | false`, which made each one
 * its own little confidence policy — and meant a GitHub account that merely
 * shared an employer was written to a record with the same authority as one
 * that named the person. Returning evidence instead puts every network through
 * the same ledger, and the difference shows up where it should: a verified
 * GitHub account lands on the record, an X handle that can only ever be
 * corroborated indirectly becomes a suggestion.
 */
export type Verdict =
	| { accepted: true; profile: SocialProfile; evidence: Evidence[] }
	| { accepted: false; reason: string };

const X_HOSTS = new Set([
	"x.com",
	"www.x.com",
	"twitter.com",
	"www.twitter.com",
	"mobile.twitter.com",
]);

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

/**
 * First-segment paths that look like a profile and are not one.
 *
 * `x.com/settings` and `github.com/pricing` parse identically to a username,
 * and both turn up in search results about a person.
 */
const X_RESERVED = new Set([
	"i",
	"home",
	"explore",
	"search",
	"settings",
	"notifications",
	"messages",
	"intent",
	"share",
	"hashtag",
	"status",
	"login",
	"signup",
	"about",
	"privacy",
	"tos",
	"compose",
]);

const GITHUB_RESERVED = new Set([
	"orgs",
	"organizations",
	"features",
	"about",
	"pricing",
	"topics",
	"collections",
	"sponsors",
	"marketplace",
	"settings",
	"login",
	"join",
	"signup",
	"enterprise",
	"apps",
	"explore",
	"trending",
	"security",
	"readme",
	"site",
	"contact",
	"search",
	"new",
	"notifications",
]);

/** X's own rule: up to 15 word characters. */
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;
/** GitHub's own rule: alphanumerics and single inner hyphens, up to 39. */
const GITHUB_HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/**
 * A profile URL, or null for anything that is not one.
 *
 * Rejects deep links on purpose: `x.com/someone/status/123` and
 * `github.com/someone/repo` both contain a real handle, and both arrive as
 * citations constantly. Taking the first segment out of them would be right
 * about the handle and wrong about what the page proves.
 */
export function parseSocialUrl(raw: string): SocialProfile | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;

	let url: URL;
	try {
		url = new URL(
			/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
		);
	} catch {
		return null;
	}

	const host = url.hostname.toLowerCase();
	const segments = url.pathname.split("/").filter(Boolean);
	if (segments.length !== 1) return null;

	const handle = decodeURIComponent(segments[0] as string).replace(/^@/, "");

	if (X_HOSTS.has(host)) {
		if (X_RESERVED.has(handle.toLowerCase())) return null;
		if (!X_HANDLE.test(handle)) return null;
		return {
			network: "x",
			handle: handle.toLowerCase(),
			url: `https://x.com/${handle}`,
		};
	}

	if (GITHUB_HOSTS.has(host)) {
		if (GITHUB_RESERVED.has(handle.toLowerCase())) return null;
		if (!GITHUB_HANDLE.test(handle)) return null;
		return {
			network: "github",
			handle: handle.toLowerCase(),
			url: `https://github.com/${handle}`,
		};
	}

	return null;
}

/** Every profile URL in a blob of text and citations, deduplicated. */
export function extractSocialUrls(haystack: string[]): SocialProfile[] {
	const found: SocialProfile[] = [];

	for (const chunk of haystack) {
		for (const match of chunk.matchAll(
			/https?:\/\/(?:www\.|mobile\.)?(?:x\.com|twitter\.com|github\.com)\/[^\s"'<>)\]},]+/gi,
		)) {
			// Prose ends in punctuation and URLs do not: a link at the end of a
			// sentence arrives as `x.com/lewiscarhart.`, which is not a handle
			// either network could issue and would otherwise be dropped silently.
			const profile = parseSocialUrl(match[0].replace(/[.,;:!?]+$/, ""));
			if (profile && !found.some((f) => f.url === profile.url)) {
				found.push(profile);
			}
		}
	}

	return found;
}

type GithubUser = {
	login: string;
	name: string | null;
	company: string | null;
	blog: string | null;
	bio: string | null;
	type: string;
};

/**
 * The account's own page, from GitHub's public API.
 *
 * `GITHUB_TOKEN` is read if it is set — unauthenticated calls are capped at 60
 * an hour per IP, which is fine for ten contacts but not for a backfill.
 */
async function fetchGithubUser(
	handle: string,
): Promise<{ ok: true; user: GithubUser } | { ok: false; reason: string }> {
	const token = process.env.GITHUB_TOKEN;

	try {
		const response = await fetch(
			`https://api.github.com/users/${encodeURIComponent(handle)}`,
			{
				headers: {
					accept: "application/vnd.github+json",
					"user-agent": "comp-ai-crm-research-agent",
					...(token ? { authorization: `Bearer ${token}` } : {}),
				},
				signal: AbortSignal.timeout(15_000),
			},
		);

		if (response.status === 404) {
			return { ok: false, reason: "No such GitHub account." };
		}
		if (response.status === 403 || response.status === 429) {
			// Rate limited is not "unverified" — it is "we do not know", and the two
			// must not collapse into a write.
			return {
				ok: false,
				reason: "GitHub rate-limited the check. Try this contact again later.",
			};
		}
		if (!response.ok) {
			return { ok: false, reason: `GitHub returned HTTP ${response.status}.` };
		}

		const body = (await response.json()) as Record<string, unknown>;

		return {
			ok: true,
			user: {
				login: String(body.login ?? handle),
				name: str(body.name),
				company: str(body.company),
				blog: str(body.blog),
				bio: str(body.bio),
				type: String(body.type ?? "User"),
			},
		};
	} catch (error) {
		return {
			ok: false,
			reason: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * What GitHub's own API says about an account, as evidence.
 *
 * The account naming the person is primary — it is their page asserting who
 * they are. The employer matching while the name does not is emphatically
 * *not*: `github.com/octocat` with `company: @acme` is a colleague, and
 * writing it to Lewis's record because they share an employer is the same
 * mistake as writing a stranger's LinkedIn to a contact because the company
 * matched. Both are recorded; the ledger prices them differently.
 */
export async function verifyGithub(
	profile: SocialProfile,
	person: Person,
): Promise<Verdict> {
	const result = await fetchGithubUser(profile.handle);
	if (!result.ok) return { accepted: false, reason: result.reason };

	const user = result.user;

	if (user.type !== "User") {
		return {
			accepted: false,
			reason: `github.com/${user.login} is an ${user.type.toLowerCase()} account, not a person.`,
		};
	}

	const evidence: Evidence[] = [];
	const named = namesMatch(user.name, person.fullName);

	const employed =
		person.companyName !== null &&
		user.company !== null &&
		looksLikeSameCompany(
			user.company,
			person.companyName,
			person.companyDomain ?? "",
		);

	if (named) {
		// One item, not one per matching field: the name and the company sit on
		// the same page, so treating them as independent sources would multiply a
		// single observation into false certainty.
		const detail = employed
			? `the account is named "${user.name}" and its company reads "${user.company}"`
			: `the account is named "${user.name}"`;
		evidence.push({
			kind: "github.account-identity",
			detail,
			sourceUrl: profile.url,
		});
	} else if (employed) {
		evidence.push({
			kind: "employer-only",
			detail: `its company reads "${user.company}" but the account is named "${user.name ?? "—"}"`,
			sourceUrl: profile.url,
		});
	}

	if (person.companyDomain) {
		const mentions = [user.blog, user.bio]
			.filter((field): field is string => Boolean(field))
			.some((field) =>
				field.toLowerCase().includes(person.companyDomain as string),
			);
		if (mentions) {
			evidence.push({
				kind: "web.cited-claim",
				detail: `the profile links ${person.companyDomain}`,
				sourceUrl: profile.url,
			});
		}
	}

	if (
		nameMatchesLocalPart(
			{ firstName: person.firstName, lastName: person.lastName },
			profile.handle,
		)
	) {
		evidence.push({
			kind: "handle.name-form",
			detail: `the handle "${profile.handle}" is a form of their name`,
			sourceUrl: profile.url,
		});
	}

	if (evidence.length === 0) {
		return {
			accepted: false,
			reason:
				`github.com/${user.login} says nothing connecting it to ${person.fullName}: ` +
				`name "${user.name ?? "—"}", company "${user.company ?? "—"}".`,
		};
	}

	return { accepted: true, profile, evidence };
}

/**
 * Whether an X account is this contact's, given that nobody can read X.
 *
 * Two things, and both are checked here rather than asked of the model. The
 * handle has to be a construction of their name, which rules out the
 * pseudonymous accounts we could never confirm; and a search engine has to cite
 * that exact profile when asked about them by name and employer, which is the
 * only outside corroboration available. A handle that is really the company's
 * account is rejected before either — `x.com/acmecorp` passes a name check for
 * nobody and gets filed against everybody.
 */
export async function verifyX(
	profile: SocialProfile,
	person: Person,
): Promise<Verdict> {
	if (
		person.companyName &&
		looksLikeSameCompany(
			profile.handle,
			person.companyName,
			person.companyDomain ?? "",
		)
	) {
		return {
			accepted: false,
			reason: `x.com/${profile.handle} looks like ${person.companyName}'s own account, not ${person.fullName}'s.`,
		};
	}

	if (
		!nameMatchesLocalPart(
			{ firstName: person.firstName, lastName: person.lastName },
			profile.handle,
		)
	) {
		return {
			accepted: false,
			reason:
				`x.com/${profile.handle} is not a form of "${person.fullName}", and X profiles cannot be read to check. ` +
				"Leave it empty.",
		};
	}

	// The tool does its own asking. A citation handed over by the model is a
	// citation the model can invent.
	const answer = await ask(
		`Is https://x.com/${profile.handle} the X (Twitter) account of ${person.fullName}` +
			`${person.title ? `, ${person.title}` : ""}` +
			`${person.companyName ? ` at ${person.companyName}` : ""}? ` +
			"Answer yes or no and give the profile URL.",
		{ domains: ["x.com", "twitter.com"] },
	);

	if (!answer.ok) {
		return {
			accepted: false,
			reason: `Could not corroborate: ${answer.reason}`,
		};
	}

	const cited = extractSocialUrls(answer.data.citations).some(
		(candidate) =>
			candidate.network === "x" && candidate.handle === profile.handle,
	);

	if (!cited) {
		return {
			accepted: false,
			reason:
				`Nothing retrieved for "${person.fullName}" cites x.com/${profile.handle}. ` +
				"A handle that merely resembles their name is a guess.",
		};
	}

	// Neither of these is primary, and that is the honest result: X cannot be
	// read, so the strongest thing available is two indirect signals agreeing.
	// The ledger turns that into a suggestion for a rep rather than a write,
	// which is the right place for a link nobody can check.
	return {
		accepted: true,
		profile,
		evidence: [
			{
				kind: "handle.name-form",
				detail: `the handle "${profile.handle}" is a form of their name`,
				sourceUrl: profile.url,
			},
			{
				kind: "search.cites-profile",
				detail: `a search for ${person.fullName} cites this profile`,
				sourceUrl: profile.url,
			},
		],
	};
}

/**
 * Candidate profile URLs from the open web.
 *
 * Candidates, never answers — same rule as LinkedIn slugs. The URLs are taken
 * from the citations rather than the prose, because a cited URL was actually
 * retrieved and a quoted one may have been composed on the spot.
 */
export async function findSocialCandidates(
	person: Person,
	network: Network,
): Promise<{ candidates: SocialProfile[]; citations: string[] }> {
	const where = network === "x" ? "X (Twitter)" : "GitHub";
	const domains = network === "x" ? ["x.com", "twitter.com"] : ["github.com"];

	const answer = await ask(
		`What is the ${where} profile of ${person.fullName}` +
			`${person.title ? `, ${person.title}` : ""}` +
			`${person.companyName ? ` at ${person.companyName}` : ""}` +
			`${person.companyDomain ? ` (${person.companyDomain})` : ""}? ` +
			"Reply with the profile URL only, or say you do not know.",
		{ domains },
	);

	if (!answer.ok) return { candidates: [], citations: [] };

	const candidates = extractSocialUrls([
		answer.data.text,
		...answer.data.citations,
	]).filter((candidate) => candidate.network === network);

	return { candidates, citations: answer.data.citations };
}

function str(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}
