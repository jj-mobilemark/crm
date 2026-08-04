/**
 * Reduces whatever a human typed to the bare host: "https://www.Stripe.com/pricing"
 * → "stripe.com".
 *
 * `Company.domain` is unique and is the enrichment key, so the same company
 * typed three ways has to collapse to one value — otherwise the constraint
 * never fires and we pay Context.dev twice for the same lookup.
 *
 * Returns `null` for anything that is not plausibly a hostname, so a typo
 * clears the field rather than creating a junk record that blocks the real one.
 */
export function normalizeDomain(
	input: string | null | undefined,
): string | null {
	const trimmed = input?.trim().toLowerCase();
	if (!trimmed) return null;

	// `new URL` needs a scheme, and bare "stripe.com" is the common case.
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//.test(trimmed)
		? trimmed
		: `https://${trimmed}`;

	let host: string;
	try {
		host = new URL(withScheme).hostname;
	} catch {
		return null;
	}

	const bare = host.replace(/^www\./, "");

	// At least one dot, and nothing but host characters — enough to reject
	// "localhost", "my company" and a pasted email address.
	return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(bare) ? bare : null;
}

/** The domain part of a work email, or `null` for a free or malformed address. */
export function domainFromEmail(
	email: string | null | undefined,
): string | null {
	const at = email?.trim().toLowerCase().lastIndexOf("@") ?? -1;
	if (at < 1) return null;
	const domain = normalizeDomain(email?.slice(at + 1));
	return domain && !FREE_EMAIL_DOMAINS.has(domain) ? domain : null;
}

/**
 * Most common work-email domain in a list, or null when none qualify.
 *
 * Used when Sage left `Company.domain` empty (or filled it with a note) but
 * contacts still carry a real corporate address.
 */
export function majorityWorkDomain(
	emails: readonly (string | null | undefined)[],
): string | null {
	const counts = new Map<string, number>();
	for (const email of emails) {
		const domain = domainFromEmail(email);
		if (!domain) continue;
		counts.set(domain, (counts.get(domain) ?? 0) + 1);
	}

	let best: string | null = null;
	let bestCount = 0;
	for (const [domain, count] of counts) {
		if (count > bestCount) {
			best = domain;
			bestCount = count;
		}
	}
	return best;
}

/**
 * Addresses that say nothing about where someone works. Creating a "Gmail"
 * company because a lead used a personal address is the classic CRM junk row.
 */
const FREE_EMAIL_DOMAINS = new Set([
	"gmail.com",
	"googlemail.com",
	"yahoo.com",
	"yahoo.co.uk",
	"hotmail.com",
	"hotmail.co.uk",
	"outlook.com",
	"live.com",
	"msn.com",
	"icloud.com",
	"me.com",
	"mac.com",
	"aol.com",
	"proton.me",
	"protonmail.com",
	"gmx.com",
	"gmx.de",
	"mail.com",
	"yandex.ru",
	"qq.com",
	"163.com",
	// Consumer ISPs — a single contact on earthlink is not the company domain.
	"earthlink.net",
	"comcast.net",
	"verizon.net",
	"att.net",
	"sbcglobal.net",
	"cox.net",
	"charter.net",
	"rr.com",
	"optonline.net",
	"frontier.com",
	"windstream.net",
	"qwest.net",
	"centurylink.net",
	"bellsouth.net",
	"pacbell.net",
	"msn.com",
]);
