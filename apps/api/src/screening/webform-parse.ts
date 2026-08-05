/**
 * Parse Mobile Mark website "Customer Question" notification emails.
 *
 * Two layouts (mechanical, no LLM):
 * 1. Labeled form — Name / Location / Company / Choose a Location / Email / Phone / Comments
 * 2. Footer table — Name / Email / Questions-Comments
 */

export type ParsedWebformLead = {
	email: string;
	displayName: string | null;
	phone: string | null;
	companyName: string | null;
	locationText: string | null;
	connectLocation: string | null;
	comments: string | null;
};

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function stripHtml(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/p>/gi, "\n")
		.replace(/<\/div>/gi, "\n")
		.replace(/<\/tr>/gi, "\n")
		.replace(/<\/td>/gi, "\t")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&#39;/g, "'")
		.replace(/&quot;/gi, '"')
		.replace(/\r/g, "")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function fieldAfter(
	text: string,
	labels: string[],
	stopLabels: string[],
): string | null {
	for (const label of labels) {
		const pattern = new RegExp(
			`${escapeRegex(label)}\\s*[:\\t]?\\s*([\\s\\S]*?)(?=${stopLabels
				.map((s) => `\\b${escapeRegex(s)}\\b`)
				.join("|")}|$)`,
			"i",
		);
		const match = text.match(pattern);
		const value = match?.[1]?.trim();
		if (value) return collapseWhitespace(value);
	}
	return null;
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collapseWhitespace(value: string): string {
	return value
		.replace(/[ \t]+/g, " ")
		.replace(/\n{2,}/g, "\n")
		.trim();
}

function extractEmail(value: string | null | undefined): string | null {
	if (!value) return null;
	const match = value.match(EMAIL_RE);
	return match?.[0]?.trim().toLowerCase() ?? null;
}

function guessCompanyFromComments(comments: string | null): string | null {
	if (!comments) return null;
	const at = comments.match(
		/\bat\s+([A-Z0-9][A-Za-z0-9&.'/\- ]{1,80}?)(?=\s*[.,]|\s+MEXICO\b|\s+USA\b|\n|$)/,
	);
	if (at?.[1]) {
		return collapseWhitespace(
			at[1].replace(/\s+(MEXICO|USA|UNITED STATES)\s*$/i, ""),
		);
	}
	return null;
}

/**
 * Returns null when the body has no usable lead email.
 */
export function parseCustomerQuestionBody(
	body: string,
	contentType: "text" | "html" = "html",
): ParsedWebformLead | null {
	const text = contentType === "html" ? stripHtml(body) : body.trim();
	if (!text) return null;

	const stop = [
		"Name",
		"Your Location",
		"Location",
		"Company Name",
		"Company",
		"Choose a Location to Connect with",
		"Email Address",
		"Email",
		"Phone",
		"Comments/Questions",
		"Questions/Comments",
		"Comments",
		"Where did you hear about Mobile Mark",
	];

	const displayName = fieldAfter(text, ["Name"], stop) ?? null;
	const locationText =
		fieldAfter(text, ["Your Location", "Location"], stop) ?? null;
	const companyName =
		fieldAfter(text, ["Company Name", "Company"], stop) ?? null;
	const connectLocation =
		fieldAfter(text, ["Choose a Location to Connect with"], stop) ?? null;
	const emailRaw = fieldAfter(text, ["Email Address", "Email"], stop) ?? null;
	const phone = fieldAfter(text, ["Phone"], stop) ?? null;
	const comments =
		fieldAfter(
			text,
			["Comments/Questions", "Questions/Comments", "Comments"],
			["Where did you hear about Mobile Mark"],
		) ?? null;

	let email = extractEmail(emailRaw);
	if (!email) {
		// Footer layout sometimes only has a mailto in the Email row; fall back.
		email = extractEmail(text);
	}
	if (!email) return null;

	// Reject if the only email is Mobile Mark's own.
	if (email.endsWith("@mobilemark.com") || email.endsWith("@antenna.com")) {
		const all = [...text.matchAll(new RegExp(EMAIL_RE.source, "gi"))].map((m) =>
			m[0].toLowerCase(),
		);
		email =
			all.find(
				(e) => !e.endsWith("@mobilemark.com") && !e.endsWith("@antenna.com"),
			) ?? null;
		if (!email) return null;
	}

	const resolvedCompany =
		companyName && !/^email$/i.test(companyName)
			? companyName
			: guessCompanyFromComments(comments);

	return {
		email,
		displayName: displayName && !displayName.includes("@") ? displayName : null,
		phone: phone && phone.length < 40 ? phone : null,
		companyName: resolvedCompany,
		locationText,
		connectLocation,
		comments,
	};
}

export function isCustomerQuestionSubject(
	subject: string | null | undefined,
): boolean {
	if (!subject) return false;
	return /customer\s+question/i.test(subject);
}
