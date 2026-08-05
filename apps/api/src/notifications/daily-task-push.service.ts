import { ActivityType, type Db, type Priority } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { MicrosoftTokenService } from "../microsoft/microsoft-token.service";
import { OutlookSendClient } from "../microsoft/outlook-send.client";

const TZ = "America/Chicago";
const MAX_LINES = 50;

type TaskRow = {
	id: string;
	subject: string | null;
	dueAt: Date | null;
	priority: Priority | null;
	company: { name: string } | null;
	contact: { firstName: string; lastName: string | null } | null;
};

type Buckets = {
	overdue: TaskRow[];
	today: TaskRow[];
	thisWeek: TaskRow[];
	other: TaskRow[];
};

export type DailyTaskPushResult = {
	chicagoDate: string;
	chicagoHour: number;
	skipped: "wrong-hour" | null;
	considered: number;
	sent: number;
	skippedEmpty: number;
	skippedAlreadySent: number;
	skippedNoSend: number;
	failed: number;
};

/**
 * Morning open-task digest emailed from each opted-in rep's Outlook to themselves.
 *
 * Mechanical only — same class as sequence sends. Cron hits this at 14:00 and
 * 15:00 UTC; we gate on America/Chicago hour 9 and a per-user last-sent date.
 */
@Injectable()
export class DailyTaskPushService {
	private readonly logger = new Logger(DailyTaskPushService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly tokens: MicrosoftTokenService,
		private readonly send: OutlookSendClient,
	) {}

	async run(options: { force?: boolean } = {}): Promise<DailyTaskPushResult> {
		const now = new Date();
		const chicagoDate = chicagoDateString(now);
		const chicagoHour = chicagoHourOf(now);

		if (!options.force && chicagoHour !== 9) {
			this.logger.log({
				message: "Daily task push skipped — not 9:00 Chicago",
				chicagoDate,
				chicagoHour,
			});
			return {
				chicagoDate,
				chicagoHour,
				skipped: "wrong-hour",
				considered: 0,
				sent: 0,
				skippedEmpty: 0,
				skippedAlreadySent: 0,
				skippedNoSend: 0,
				failed: 0,
			};
		}

		const weekEnd = endOfChicagoWeek(chicagoDate);

		const users = await this.db.user.findMany({
			where: { dailyTaskPush: true },
			select: {
				id: true,
				email: true,
				name: true,
				dailyTaskPushLastSentOn: true,
			},
		});

		const result: DailyTaskPushResult = {
			chicagoDate,
			chicagoHour,
			skipped: null,
			considered: users.length,
			sent: 0,
			skippedEmpty: 0,
			skippedAlreadySent: 0,
			skippedNoSend: 0,
			failed: 0,
		};

		for (const user of users) {
			if (!options.force && user.dailyTaskPushLastSentOn === chicagoDate) {
				result.skippedAlreadySent += 1;
				continue;
			}

			const tokenResult = await this.tokens.accessTokenForSend(user.id);
			if (tokenResult.outcome !== "ok") {
				this.logger.warn({
					message: "Daily task push skipped — no send token",
					userId: user.id,
					reason: tokenResult.reason,
				});
				result.skippedNoSend += 1;
				continue;
			}

			const tasks = await this.db.activity.findMany({
				where: {
					type: ActivityType.TASK,
					createdById: user.id,
					completedAt: null,
				},
				orderBy: [
					{ priority: { sort: "desc", nulls: "last" } },
					{ dueAt: { sort: "asc", nulls: "last" } },
					{ createdAt: "desc" },
				],
				select: {
					id: true,
					subject: true,
					dueAt: true,
					priority: true,
					company: { select: { name: true } },
					contact: { select: { firstName: true, lastName: true } },
				},
			});

			if (tasks.length === 0) {
				result.skippedEmpty += 1;
				continue;
			}

			const buckets = bucketTasks(tasks, chicagoDate, weekEnd);
			const { htmlBody, lineCount } = renderHtml(buckets, chicagoDate);
			if (lineCount === 0) {
				result.skippedEmpty += 1;
				continue;
			}

			const subject = `Your tasks — ${formatSubjectDate(chicagoDate)}`;
			const sendResult = await this.send.sendMail(tokenResult.accessToken, {
				to: user.email,
				subject,
				htmlBody,
			});

			if (sendResult.outcome !== "ok") {
				this.logger.warn({
					message: "Daily task push send failed",
					userId: user.id,
					outcome: sendResult.outcome,
					reason: sendResult.reason,
				});
				result.failed += 1;
				continue;
			}

			await this.db.user.update({
				where: { id: user.id },
				data: { dailyTaskPushLastSentOn: chicagoDate },
			});
			result.sent += 1;
		}

		this.logger.log({
			message: "Daily task push finished",
			...result,
		});

		return result;
	}
}

/** YYYY-MM-DD in America/Chicago. */
export function chicagoDateString(date: Date): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: TZ,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(date);
}

function chicagoHourOf(date: Date): number {
	const hour = new Intl.DateTimeFormat("en-US", {
		timeZone: TZ,
		hour: "numeric",
		hourCycle: "h23",
	}).format(date);
	return Number(hour);
}

/** Last day of the US calendar week (Sunday) as YYYY-MM-DD in Chicago. */
function endOfChicagoWeek(today: string): string {
	const weekday = chicagoWeekday(today);
	// Sun=0 … Sat=6
	const daysUntilSunday = weekday === 0 ? 0 : 7 - weekday;
	return addChicagoDays(today, daysUntilSunday);
}

function parseYmd(ymd: string): { y: number; m: number; d: number } {
	const [yStr, mStr, dStr] = ymd.split("-");
	const y = Number(yStr);
	const m = Number(mStr);
	const d = Number(dStr);
	if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
		throw new Error(`Invalid Chicago date: ${ymd}`);
	}
	return { y, m, d };
}

function chicagoWeekday(ymd: string): number {
	// Noon UTC on that calendar date is always the same Chicago calendar day
	// for America/Chicago (no DST ambiguity at midday).
	const { y, m, d } = parseYmd(ymd);
	const probe = new Date(Date.UTC(y, m - 1, d, 18, 0, 0));
	const name = new Intl.DateTimeFormat("en-US", {
		timeZone: TZ,
		weekday: "short",
	}).format(probe);
	const map: Record<string, number> = {
		Sun: 0,
		Mon: 1,
		Tue: 2,
		Wed: 3,
		Thu: 4,
		Fri: 5,
		Sat: 6,
	};
	return map[name] ?? 0;
}

function addChicagoDays(ymd: string, days: number): string {
	const { y, m, d } = parseYmd(ymd);
	const probe = new Date(Date.UTC(y, m - 1, d + days, 18, 0, 0));
	return chicagoDateString(probe);
}

function bucketTasks(
	tasks: TaskRow[],
	today: string,
	weekEnd: string,
): Buckets {
	const buckets: Buckets = {
		overdue: [],
		today: [],
		thisWeek: [],
		other: [],
	};

	for (const task of tasks) {
		if (!task.dueAt) {
			buckets.other.push(task);
			continue;
		}
		const due = chicagoDateString(task.dueAt);
		if (due < today) buckets.overdue.push(task);
		else if (due === today) buckets.today.push(task);
		else if (due <= weekEnd) buckets.thisWeek.push(task);
		else buckets.other.push(task);
	}

	return buckets;
}

function renderHtml(
	buckets: Buckets,
	chicagoDate: string,
): { htmlBody: string; lineCount: number } {
	const sections: Array<{ title: string; tasks: TaskRow[] }> = [
		{ title: "Overdue", tasks: buckets.overdue },
		{ title: "Due today", tasks: buckets.today },
		{ title: "Due this week", tasks: buckets.thisWeek },
		{ title: "Other", tasks: buckets.other },
	];

	let remaining = MAX_LINES;
	const parts: string[] = [
		`<p style="font-family:system-ui,sans-serif;font-size:14px;color:#111">Open tasks for ${escapeHtml(formatSubjectDate(chicagoDate))}.</p>`,
	];
	let lineCount = 0;
	let truncated = false;

	for (const section of sections) {
		if (section.tasks.length === 0) continue;

		if (remaining <= 0) {
			truncated = true;
			break;
		}

		const take = Math.min(section.tasks.length, remaining);
		const shown = section.tasks.slice(0, take);
		const hidden = section.tasks.length - shown.length;

		parts.push(
			`<h2 style="font-family:system-ui,sans-serif;font-size:14px;margin:20px 0 8px">${escapeHtml(section.title)} (${section.tasks.length})</h2>`,
		);
		parts.push(
			'<ul style="font-family:system-ui,sans-serif;font-size:14px;padding-left:18px;margin:0">',
		);
		for (const task of shown) {
			parts.push(`<li style="margin:0 0 6px">${formatTaskLine(task)}</li>`);
			lineCount += 1;
			remaining -= 1;
		}
		parts.push("</ul>");

		if (hidden > 0) {
			truncated = true;
			break;
		}
	}

	if (truncated) {
		const total =
			buckets.overdue.length +
			buckets.today.length +
			buckets.thisWeek.length +
			buckets.other.length;
		const more = total - lineCount;
		if (more > 0) {
			parts.push(
				`<p style="font-family:system-ui,sans-serif;font-size:13px;color:#666">+${more} more — open Tasks in the CRM.</p>`,
			);
		}
	}

	return { htmlBody: parts.join("\n"), lineCount };
}

function formatTaskLine(task: TaskRow): string {
	const title = escapeHtml(task.subject?.trim() || "Untitled task");
	const bits: string[] = [title];
	if (task.dueAt) {
		bits.push(escapeHtml(formatDue(task.dueAt)));
	}
	const anchor = task.company?.name
		? task.company.name
		: task.contact
			? [task.contact.firstName, task.contact.lastName]
					.filter(Boolean)
					.join(" ")
			: null;
	if (anchor) bits.push(escapeHtml(anchor));
	return bits.join(" · ");
}

function formatDue(dueAt: Date): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone: TZ,
		month: "short",
		day: "numeric",
	}).format(dueAt);
}

function formatSubjectDate(ymd: string): string {
	const { y, m, d } = parseYmd(ymd);
	const probe = new Date(Date.UTC(y, m - 1, d, 18, 0, 0));
	return new Intl.DateTimeFormat("en-US", {
		timeZone: TZ,
		weekday: "short",
		month: "short",
		day: "numeric",
	}).format(probe);
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}
