/**
 * Template rendering and sending-window helpers for email sequences.
 *
 * Pure functions — no Nest DI — so the tick service and unit tests share them.
 */

const MERGE_TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export type MergeContext = {
	firstName: string;
	lastName: string;
	fullName: string;
	email: string;
	companyName: string;
	title: string;
	senderName: string;
};

/** Replace `{{token}}` placeholders; unknown tokens become empty strings. */
export function renderMerge(
	template: string,
	ctx: MergeContext,
): string {
	const values: Record<string, string> = {
		firstName: ctx.firstName,
		lastName: ctx.lastName,
		fullName: ctx.fullName,
		email: ctx.email,
		companyName: ctx.companyName,
		company: ctx.companyName,
		title: ctx.title,
		senderName: ctx.senderName,
	};

	return template.replace(MERGE_TOKEN, (_match, key: string) => values[key] ?? "");
}

/**
 * Wrap http(s) links for click tracking and append an open pixel + unsubscribe
 * footer when tracking is enabled.
 */
export function injectTracking(
	html: string,
	opts: {
		enabled: boolean;
		publicBaseUrl: string;
		trackingToken: string;
	},
): string {
	const openUrl = `${opts.publicBaseUrl}/t/open/${opts.trackingToken}`;
	const unsubUrl = `${opts.publicBaseUrl}/u/${opts.trackingToken}`;
	const footer = `<p style="margin-top:24px;font-size:12px;color:#666;">If you no longer want these emails, <a href="${unsubUrl}">unsubscribe</a>.</p>`;

	let body = html;
	if (opts.enabled) {
		body = body.replace(
			/href=(["'])(https?:\/\/[^"']+)\1/gi,
			(_m, quote: string, url: string) => {
				const tracked = `${opts.publicBaseUrl}/t/click/${opts.trackingToken}?u=${encodeURIComponent(url)}`;
				return `href=${quote}${tracked}${quote}`;
			},
		);
		body += `<img src="${openUrl}" width="1" height="1" alt="" style="display:none;" />`;
	}

	return `${body}${footer}`;
}

/** Whether `now` falls inside the sequence's local sending window. */
export function isInsideSendWindow(
	now: Date,
	opts: {
		timezone: string;
		sendWindowStartMinute: number;
		sendWindowEndMinute: number;
		sendDays: number[];
	},
): boolean {
	const parts = localParts(now, opts.timezone);
	if (!opts.sendDays.includes(parts.weekday)) return false;
	const minute = parts.hour * 60 + parts.minute;
	return (
		minute >= opts.sendWindowStartMinute && minute < opts.sendWindowEndMinute
	);
}

/**
 * The next Date (UTC) at which the sending window opens, at or after `from`.
 * Used to push `nextRunAt` when a tick finds the window closed.
 */
export function nextSendWindowOpen(
	from: Date,
	opts: {
		timezone: string;
		sendWindowStartMinute: number;
		sendWindowEndMinute: number;
		sendDays: number[];
	},
): Date {
	// Walk forward up to 8 days so we always find a matching weekday.
	for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
		const candidate = new Date(from.getTime() + dayOffset * 24 * 60 * 60 * 1000);
		const parts = localParts(candidate, opts.timezone);
		if (!opts.sendDays.includes(parts.weekday)) continue;

		const start = zonedDate(
			parts.year,
			parts.month,
			parts.day,
			Math.floor(opts.sendWindowStartMinute / 60),
			opts.sendWindowStartMinute % 60,
			opts.timezone,
		);

		if (dayOffset === 0) {
			const minute = parts.hour * 60 + parts.minute;
			if (
				minute >= opts.sendWindowStartMinute &&
				minute < opts.sendWindowEndMinute
			) {
				return from;
			}
			if (minute < opts.sendWindowStartMinute) {
				return start;
			}
			// Past today's window — try tomorrow.
			continue;
		}

		return start;
	}

	// Fallback: one day later (should be unreachable with a non-empty sendDays).
	return new Date(from.getTime() + 24 * 60 * 60 * 1000);
}

function localParts(
	date: Date,
	timezone: string,
): {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	weekday: number;
} {
	const fmt = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
		weekday: "short",
	});
	const parts = Object.fromEntries(
		fmt.formatToParts(date).map((p) => [p.type, p.value]),
	);
	const weekdayMap: Record<string, number> = {
		Sun: 0,
		Mon: 1,
		Tue: 2,
		Wed: 3,
		Thu: 4,
		Fri: 5,
		Sat: 6,
	};

	return {
		year: Number(parts.year),
		month: Number(parts.month),
		day: Number(parts.day),
		hour: Number(parts.hour),
		minute: Number(parts.minute),
		weekday: weekdayMap[parts.weekday ?? ""] ?? 0,
	};
}

/**
 * Build a UTC Date that corresponds to a civil datetime in `timezone`.
 * Uses iterative offset correction (good enough for sending windows).
 */
function zonedDate(
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
	timezone: string,
): Date {
	const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
	const asLocal = localParts(utcGuess, timezone);
	const desiredAsMinutes =
		(((year * 12 + month) * 31 + day) * 24 + hour) * 60 + minute;
	const actualAsMinutes =
		(((asLocal.year * 12 + asLocal.month) * 31 + asLocal.day) * 24 +
			asLocal.hour) *
			60 +
		asLocal.minute;
	const deltaMinutes = desiredAsMinutes - actualAsMinutes;
	return new Date(utcGuess.getTime() + deltaMinutes * 60_000);
}

/** Coerce JSON sendDays into a number[]. */
export function parseSendDays(value: unknown): number[] {
	if (Array.isArray(value) && value.every((v) => typeof v === "number")) {
		return value as number[];
	}
	return [1, 2, 3, 4, 5];
}
