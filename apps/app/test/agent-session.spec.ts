import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import type { MessageStreamEvent, SessionState } from "eve/client";
import { recordCopy, recordFilter, recordHeader } from "../lib/agent-record";
import { classify, composerState, eventsOf } from "../lib/agent-session";

/**
 * Picking a conversation back up.
 *
 * The state of a thread comes from one `session.snapshot()` — events, cursor,
 * and a continuation token if and only if eve will accept another turn. What
 * is left to decide is what a snapshot with *no* token means, and that is the
 * whole of `classify`.
 */

const NOW = Date.parse("2026-08-01T12:00:00.000Z");

const event = (
	type: string,
	at: string = "2026-08-01T12:00:00.000Z",
): MessageStreamEvent =>
	({ type, data: {}, meta: { id: `evt_${type}`, at } }) as MessageStreamEvent;

const parked: SessionState = {
	sessionId: "wrun_1",
	continuationToken: "eve:live",
	streamIndex: 3,
};

const unparked: SessionState = { sessionId: "wrun_1", streamIndex: 3 };

describe("classify", () => {
	it("trusts the token over any reading of the events", () => {
		// eve returns one only when the captured prefix ends parked, which is
		// exactly the condition under which the next send is accepted. Nothing we
		// could infer from the event list is a better answer than that.
		expect(classify(parked, [event("message.appended")], NOW)).toBe("ready");
	});

	it("knows a terminal session cannot be continued", () => {
		expect(classify(unparked, [event("session.completed")], NOW)).toBe("ended");
		expect(classify(unparked, [event("session.failed")], NOW)).toBe("ended");
	});

	it("reads a turn still emitting as working", () => {
		const recent = event("message.appended", "2026-08-01T11:59:30.000Z");

		expect(classify(unparked, [recent], NOW)).toBe("working");
	});

	it("retires a turn that stopped mid-sentence", () => {
		// A restarted agent leaves sessions with no closing boundary. They never
		// park, so without this they read as working forever and that thread can
		// never be typed into again.
		const stalled = event("message.appended", "2026-08-01T11:50:00.000Z");

		expect(classify(unparked, [stalled], NOW)).toBe("ended");
	});

	it("does not retire a live turn for want of a timestamp", () => {
		const undated = { type: "step.started", data: {}, meta: { id: "x" } };

		expect(classify(unparked, [undated as MessageStreamEvent], NOW)).toBe(
			"working",
		);
	});
});

describe("the composer", () => {
	it("takes input on a parked thread, and on one not started yet", () => {
		expect(
			composerState({ status: "ready", session: parked, events: [] }, false),
		).toEqual({ locked: false, ended: false });
		expect(composerState({ status: "new" }, false)).toEqual({
			locked: false,
			ended: false,
		});
		expect(composerState(undefined, false)).toEqual({
			locked: false,
			ended: false,
		});
	});

	it("holds input while a turn is in flight, from either side", () => {
		// `busy` is this panel's own send; `working` is a turn somebody else
		// started. eve rejects input in both cases.
		expect(
			composerState({ status: "ready", session: parked, events: [] }, true)
				.locked,
		).toBe(true);
		expect(
			composerState(
				{ status: "working", session: unparked, events: [] },
				false,
			),
		).toEqual({ locked: true, ended: false });
	});

	it("says an ended thread is ended rather than merely busy", () => {
		// The bug this exists for: an answered question sat above a composer
		// disabled with "still working on the last question", forever, and the
		// only way on — a new thread — was never offered.
		expect(
			composerState({ status: "ended", session: unparked, events: [] }, false),
		).toEqual({ locked: true, ended: true });
	});

	it("lets somebody type when the agent could not be reached", () => {
		// Not locked: that read fails the same way every time, so locking on it
		// is permanent. A send either works or raises a visible error.
		expect(composerState({ status: "offline", events: [] }, false)).toEqual({
			locked: false,
			ended: false,
		});
	});
});

describe("eventsOf", () => {
	it("renders the transcript in every state that has one", () => {
		const events = [event("message.completed")];

		expect(eventsOf({ status: "offline", events })).toEqual(events);
		expect(eventsOf({ status: "ended", session: unparked, events })).toEqual(
			events,
		);
		expect(eventsOf({ status: "new" })).toEqual([]);
		expect(eventsOf(undefined)).toEqual([]);
	});
});

describe("record context", () => {
	it("asks about the thing you are actually looking at", () => {
		expect(recordCopy("contact").title).toBe("Ask about this person");
		expect(recordCopy("company").title).toBe("Ask about this company");
		expect(recordCopy("deal").title).toBe("Ask about this deal");
		expect(recordCopy("pipeline").title).toBe("Ask about the pipeline");
	});

	it("offers questions that suit the record", () => {
		// The tell of a bolted-on chat box is "Who is this person?" on a company.
		expect(recordCopy("company").suggestions.join(" ")).not.toContain("person");
		expect(recordCopy("deal").suggestions.join(" ")).not.toContain("person");
		expect(recordCopy("contact").suggestions[0]).toBe("Who is this person?");
		expect(recordCopy("pipeline").suggestions[0]).toBe("What moved this week?");
	});

	it("tells the agent which record it is on", () => {
		expect(recordHeader({ kind: "contact", id: "c1" })).toEqual({
			"x-crm-contact": "c1",
		});
		expect(recordHeader({ kind: "company", id: "co1" })).toEqual({
			"x-crm-company": "co1",
		});
		expect(recordHeader({ kind: "deal", id: "d1" })).toEqual({
			"x-crm-deal": "d1",
		});
		expect(recordHeader({ kind: "pipeline", id: "everyone" })).toEqual({
			"x-crm-pipeline": "everyone",
		});
	});

	it("files a conversation under one record and no other", () => {
		expect(recordFilter({ kind: "deal", id: "d1" })).toEqual({ dealId: "d1" });
		expect(Object.keys(recordFilter({ kind: "company", id: "co1" }))).toEqual([
			"companyId",
		]);
		expect(recordFilter({ kind: "pipeline", id: "me" })).toEqual({
			pipelineScope: "me",
		});
	});
});

describe("the panel", () => {
	const source = () =>
		readFileSync(
			new URL("../components/crm/agent-panel.tsx", import.meta.url),
			"utf8",
		);

	/**
	 * A source-level check, deliberately.
	 *
	 * This bug shipped twice: the suggestions were wired to the record while the
	 * heading above them stayed a literal, so a deal offered "Where does this
	 * stand?" under "Ask about this person". There is no DOM here to render
	 * against, and the defect is precisely "a string that should have come from
	 * `recordCopy` did not" — which is visible in the file.
	 */
	it("takes its copy from the record, never from a literal", () => {
		for (const kind of ["contact", "company", "deal", "pipeline"] as const) {
			const copy = recordCopy(kind);
			for (const literal of [copy.title, copy.blurb, copy.placeholder]) {
				expect(source()).not.toContain(literal);
			}
		}
	});

	it("offers a way out of a thread that has ended", () => {
		// A finished thread locks its composer. Without this button there is
		// nothing at all the reader can do with the sheet in front of them.
		expect(source()).toContain("Start a new conversation");
		expect(source()).toContain("onClick={onNewThread}");
	});
});

describe("the record sheet", () => {
	/**
	 * The panel holds a live stream. Radix unmounts an inactive tab by default,
	 * which aborts it mid-answer — the reply then lands in the durable session
	 * with nothing attached to receive it, and coming back to the tab showed a
	 * question with no answer under it.
	 */
	it("keeps the agent tab mounted behind the others", () => {
		for (const sheet of ["contact", "company", "deal"]) {
			const source = readFileSync(
				new URL(
					`../components/crm/record-sheet/${sheet}-sheet.tsx`,
					import.meta.url,
				),
				"utf8",
			);

			expect(source).toContain("keepMounted: true");
		}

		const sheet = readFileSync(
			new URL("../components/detail-sheet.tsx", import.meta.url),
			"utf8",
		);

		// Kept alive once opened, and not rendered at all before that.
		expect(sheet).toContain("tab.keepMounted && opened.has(tab.value)");
		// Without this the kept-alive panel renders on top of the visible tab:
		// `display:flex` on the same element beats the `hidden` attribute.
		expect(sheet).toContain("data-[state=inactive]:hidden");
	});
});
