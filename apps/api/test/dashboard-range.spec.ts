import { describe, expect, it } from "bun:test";
import { ActivityType } from "@crm/db";
import {
	INBOX_FEED_SUBJECTS,
	overdueOpenWhere,
	recentActivityWhere,
	resolveRange,
} from "../src/dashboard/dashboard.service";
import { OPEN_DEAL_STAGES } from "../src/deals/deal-stage";

describe("resolveRange this_month", () => {
	it("spans the full calendar month, not month-to-date", () => {
		const now = new Date(2026, 7, 18, 15, 47);
		const range = resolveRange(
			{ scope: "everyone", range: "this_month" },
			now,
		);

		expect(range.start).toEqual(new Date(2026, 7, 1));
		expect(range.end).toEqual(new Date(2026, 8, 1));
		expect(range.previousStart).toEqual(new Date(2026, 6, 1));
		expect(range.previousEnd).toEqual(new Date(2026, 7, 1));
		expect(range.windowDays).toBe(31);
	});

	it("still includes a Won deal whose close date is later this month", () => {
		const now = new Date(2026, 7, 18, 15, 47);
		const range = resolveRange(
			{ scope: "everyone", range: "this_month" },
			now,
		);
		const laterThisMonth = new Date(2026, 7, 28, 12);

		expect(laterThisMonth >= range.start).toBe(true);
		expect(laterThisMonth < range.end).toBe(true);
	});
});

describe("overdueOpenWhere", () => {
	it("is open deals with a close date before now", () => {
		const now = new Date(2026, 8, 11, 22);
		expect(overdueOpenWhere(now)).toEqual({
			stage: { in: [...OPEN_DEAL_STAGES] },
			expectedCloseDate: { lt: now },
		});
	});
});

describe("recentActivityWhere", () => {
	it("scopes Me to the acting user", () => {
		expect(recentActivityWhere(true, "user-1")).toEqual({
			createdById: "user-1",
		});
	});

	it("keeps the team CRM log on Everyone, with no mailbox rows", () => {
		expect(recentActivityWhere(false, "user-1")).toEqual({
			type: { not: ActivityType.EMAIL },
			emailThreadId: null,
			calendarEventId: null,
			NOT: { subject: { in: [...INBOX_FEED_SUBJECTS] } },
		});
	});
});
