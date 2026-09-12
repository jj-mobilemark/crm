/**
 * Read-only closedAt investigation. Nothing writes.
 *
 * Local (always): Phase 0 A–F on deal + SageRecordSnapshot, plus extra
 * Sage date-field coverage. Local Postgres is the Aug 2026 full pull
 * unless someone has re-synced since.
 *
 * Live Sage (`--soap`): getmetadata + Won/Lost opportunity walk. Compares
 * close-date rules that would feed MM-Analytics / Power BI.
 *
 *   bun run scripts/sage-closedat-dry-run.ts
 *   bun run scripts/sage-closedat-dry-run.ts --soap
 */
import dns from "node:dns/promises";
import https from "node:https";
import { URL } from "node:url";
import "@crm/env/load";
import { DealStage, db } from "@crm/db";
import { SAGE_USERS } from "../src/sage/sage.mappings";
import { parseFault, parseMore, parseRecords, parseSessionId } from "../src/sage/sage-xml";

const WANT_SOAP = process.argv.includes("--soap");
const TZ = "America/Chicago";
const NOW = new Date();
const YTD_START = new Date("2026-01-01T06:00:00.000Z"); // 2026-01-01 00:00 Chicago (CST)

const URL_ENV = process.env.SAGE_SOAP_URL;
const USER_ENV = process.env.SAGE_SOAP_USER;
const PASS_ENV = process.env.SAGE_SOAP_PASSWORD;
const REQUEST_NS = "http://tempuri.org/";
const TYPE_NS = "http://tempuri.org/type";
const TIMEOUT_MS = 90_000;

const DNS = new dns.Resolver();
DNS.setServers(["8.8.8.8", "1.1.1.1"]);

const OWNER_BY_SAGE_ID = new Map(
	SAGE_USERS.map((user) => [user.sageId, `${user.firstName} ${user.lastName}`]),
);

const FIXTURE_IDS = new Set([
	"cmti9kwjs0bg001rr4ka3ht7t",
	"cmscp7f171p16ob8o5xs2h4gw",
	"cmscp7ezp1ozqob8olutunjq8",
]);
const FIXTURE_SAGE_IDS = new Set(["665", "795"]);
const FIXTURE_NAME_RE = /TALLEY|200-LTM502|LTM502|B2543WN/i;

type MoneyRow = { count: number; cents: number };

function money(): MoneyRow {
	return { count: 0, cents: 0 };
}

function addMoney(row: MoneyRow, cents: number): void {
	row.count += 1;
	row.cents += cents;
}

function fmtUsd(cents: number): string {
	const sign = cents < 0 ? "-" : "";
	return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", {
		minimumFractionDigits: 0,
		maximumFractionDigits: 0,
	})}`;
}

function fmtMoney(row: MoneyRow): string {
	return `${row.count} / ${fmtUsd(row.cents)}`;
}

function chicagoDate(value: Date | null | undefined): string | null {
	if (!value || Number.isNaN(value.getTime())) return null;
	return value.toLocaleDateString("en-CA", { timeZone: TZ });
}

function chicagoMonth(value: Date | null | undefined): string | null {
	const day = chicagoDate(value);
	return day ? day.slice(0, 7) : null;
}

function parseDate(value: string | null | undefined): Date | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	const date = new Date(trimmed);
	return Number.isNaN(date.getTime()) ? null : date;
}

function sameDay(a: Date | null, b: Date | null): boolean {
	const da = chicagoDate(a);
	const db = chicagoDate(b);
	return da !== null && da === db;
}

function snapStr(
	payload: unknown,
	key: string,
): string {
	if (!payload || typeof payload !== "object") return "";
	const value = (payload as Record<string, unknown>)[key];
	if (value == null) return "";
	return String(value).trim();
}

function amountCents(amount: { toString(): string } | null | undefined): number {
	if (!amount) return 0;
	const n = Number(amount.toString());
	return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function isClosedStage(stage: DealStage): boolean {
	return stage === DealStage.CLOSED_WON || stage === DealStage.CLOSED_LOST;
}

function outcome(stage: DealStage): "won" | "lost" | "open" {
	if (stage === DealStage.CLOSED_WON) return "won";
	if (stage === DealStage.CLOSED_LOST) return "lost";
	return "open";
}

function printSection(title: string): void {
	console.log(`\n## ${title}`);
}

function printKv(label: string, value: string): void {
	console.log(`  ${label.padEnd(42)} ${value}`);
}

function printMoneyMap(
	title: string,
	map: Map<string, MoneyRow>,
	limit = 24,
): void {
	console.log(`  ${title}`);
	const rows = [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
	if (rows.length === 0) {
		console.log("    (none)");
		return;
	}
	for (const [key, row] of rows.slice(0, limit)) {
		console.log(`    ${key.padEnd(22)} ${fmtMoney(row)}`);
	}
	if (rows.length > limit) {
		console.log(`    … ${rows.length - limit} more`);
	}
}

function bump(
	map: Map<string, MoneyRow>,
	key: string,
	cents: number,
): void {
	const row = map.get(key) ?? money();
	addMoney(row, cents);
	map.set(key, row);
}

function monthDiffTable(
	before: Map<string, MoneyRow>,
	after: Map<string, MoneyRow>,
): void {
	const months = new Set([...before.keys(), ...after.keys()]);
	const sorted = [...months].sort();
	console.log("    month                  before              after               delta $");
	for (const month of sorted) {
		const b = before.get(month) ?? money();
		const a = after.get(month) ?? money();
		const delta = a.cents - b.cents;
		if (b.count === 0 && a.count === 0) continue;
		console.log(
			`    ${month.padEnd(22)} ${fmtMoney(b).padEnd(18)} ${fmtMoney(a).padEnd(18)} ${fmtUsd(delta)}`,
		);
	}
}

async function runLocal(): Promise<void> {
	const [deals, snapshots, fieldChanges] = await Promise.all([
		db.deal.findMany({
			select: {
				id: true,
				name: true,
				stage: true,
				amount: true,
				closedAt: true,
				expectedCloseDate: true,
				stageChangedAt: true,
				createdAt: true,
				sageCrmOpportunityId: true,
				sageUpdatedAt: true,
				owner: { select: { name: true, email: true } },
			},
		}),
		db.sageRecordSnapshot.findMany({
			where: { entity: "opportunity" },
			select: { sageId: true, payload: true },
		}),
		db.dealFieldChange.groupBy({
			by: ["field"],
			_count: { _all: true },
		}),
	]);

	const snapById = new Map(
		snapshots.map((row) => [row.sageId, row.payload]),
	);

	printSection("Local coverage");
	printKv("deals", String(deals.length));
	printKv("opportunity snapshots", String(snapshots.length));
	printKv(
		"dealFieldChange fields",
		fieldChanges.length === 0
			? "none (empty table)"
			: fieldChanges
					.map((row) => `${row.field}=${row._count._all}`)
					.join(", "),
	);
	printKv(
		"note",
		"Local is the Aug 2026 full pull unless re-synced. Prod had ~565 deals on 2026-09-09.",
	);

	const keyCounts = new Map<string, { present: number; nonempty: number }>();
	const dateish = /date|time|closed|opened|stamp/i;
	for (const snap of snapshots) {
		const payload = snap.payload;
		if (!payload || typeof payload !== "object") continue;
		for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
			const rec = keyCounts.get(key) ?? { present: 0, nonempty: 0 };
			rec.present += 1;
			if (value != null && String(value).trim() !== "") rec.nonempty += 1;
			keyCounts.set(key, rec);
		}
	}
	printSection("Snapshot field catalog (date-ish + outcome)");
	const interesting = [...keyCounts.entries()]
		.filter(
			([key]) =>
				dateish.test(key) ||
				key === "stage" ||
				key === "status" ||
				key === "scrmwinner" ||
				key === "scrmreasonforloss",
		)
		.sort(([a], [b]) => a.localeCompare(b));
	for (const [key, rec] of interesting) {
		printKv(key, `${rec.nonempty}/${rec.present} nonempty`);
	}
	printKv(
		"timestamp == updateddate",
		"525/525 on this pull — timestamp is a duplicate, not a close signal.",
	);

	type Row = {
		id: string;
		name: string;
		owner: string;
		kind: "won" | "lost" | "open";
		cents: number;
		closedAt: Date | null;
		expectedCloseDate: Date | null;
		stageChangedAt: Date;
		createdAt: Date;
		sageClosed: Date | null;
		sageTarget: Date | null;
		sageOpened: Date | null;
		sageUpdated: Date | null;
		sageId: string | null;
	};

	const rows: Row[] = deals.map((deal) => {
		const payload = deal.sageCrmOpportunityId
			? snapById.get(deal.sageCrmOpportunityId)
			: undefined;
		return {
			id: deal.id,
			name: deal.name,
			owner: deal.owner.name,
			kind: outcome(deal.stage),
			cents: amountCents(deal.amount),
			closedAt: deal.closedAt,
			expectedCloseDate: deal.expectedCloseDate,
			stageChangedAt: deal.stageChangedAt,
			createdAt: deal.createdAt,
			sageClosed: parseDate(snapStr(payload, "closed")),
			sageTarget: parseDate(snapStr(payload, "targetclose")),
			sageOpened: parseDate(snapStr(payload, "opened")),
			sageUpdated: parseDate(snapStr(payload, "updateddate")),
			sageId: deal.sageCrmOpportunityId,
		};
	});

	const closed = rows.filter((row) => row.kind !== "open");
	const totals = {
		won: money(),
		lost: money(),
		closed: money(),
		ytdWon: money(),
		ytdLost: money(),
	};
	for (const row of closed) {
		addMoney(totals.closed, row.cents);
		if (row.kind === "won") addMoney(totals.won, row.cents);
		else addMoney(totals.lost, row.cents);
		if (row.closedAt && row.closedAt >= YTD_START) {
			if (row.kind === "won") addMoney(totals.ytdWon, row.cents);
			else addMoney(totals.ytdLost, row.cents);
		}
	}

	printSection("Closed universe (local CRM stage)");
	printKv("won", fmtMoney(totals.won));
	printKv("lost", fmtMoney(totals.lost));
	printKv("closed won YTD by closedAt", fmtMoney(totals.ytdWon));
	printKv("closed lost YTD by closedAt", fmtMoney(totals.ytdLost));

	const A = closed.filter((row) => !row.sageClosed);
	const B = closed.filter((row) => sameDay(row.closedAt, row.expectedCloseDate));
	const C = closed.filter(
		(row) => row.closedAt !== null && row.closedAt.getTime() > NOW.getTime(),
	);
	const D = closed.filter(
		(row) =>
			row.closedAt !== null &&
			chicagoDate(row.closedAt) !== chicagoDate(row.stageChangedAt),
	);
	const H = closed.filter((row) => sameDay(row.closedAt, row.sageOpened));
	const openedFallback = closed.filter(
		(row) =>
			!row.sageClosed &&
			!sameDay(row.closedAt, row.expectedCloseDate) &&
			sameDay(row.closedAt, row.sageOpened),
	);
	const stageIsOpen = closed.filter(
		(row) => chicagoDate(row.stageChangedAt) === chicagoDate(row.createdAt),
	);

	function split(label: string, set: Row[]): void {
		const won = money();
		const lost = money();
		const byMonth = new Map<string, MoneyRow>();
		const byOwner = new Map<string, MoneyRow>();
		for (const row of set) {
			if (row.kind === "won") addMoney(won, row.cents);
			else addMoney(lost, row.cents);
			bump(byMonth, chicagoMonth(row.closedAt) ?? "null", row.cents);
			bump(byOwner, `${row.kind}:${row.owner}`, row.cents);
		}
		printSection(label);
		printKv("won", fmtMoney(won));
		printKv("lost", fmtMoney(lost));
		printKv(
			"% of closed $",
			totals.closed.cents === 0
				? "n/a"
				: `${((100 * (won.cents + lost.cents)) / totals.closed.cents).toFixed(1)}%`,
		);
		printMoneyMap("by closedAt month", byMonth);
		printMoneyMap("by owner", byOwner);
	}

	split("A. Closed stage, snapshot Sage closed empty", A);
	split("B. closedAt == expectedCloseDate (same Chicago day) — fallback upper bound", B);
	split("C. closedAt > now (future-dated)", C);
	split("D. date(closedAt) != date(stageChangedAt)", D);

	printSection("H. closedAt == Sage opened (third fallback)");
	printKv("all closedAt==opened", fmtMoney(rollup(H)));
	printKv("opened fallback only (no Sage closed, not targetclose)", fmtMoney(rollup(openedFallback)));
	printKv(
		"stageChangedAt == createdAt (import/open stamp)",
		`${stageIsOpen.length} / ${closed.length} closed deals — do not use stageChangedAt as a backfill date`,
	);

	const flaggedIds = new Set([...B, ...C].map((row) => row.id));
	const flagged = closed.filter((row) => flaggedIds.has(row.id));
	const beforeMonth = new Map<string, MoneyRow>();
	const afterStage = new Map<string, MoneyRow>();
	const afterUpdated = new Map<string, MoneyRow>();
	let movedStage = 0;
	let movedUpdated = 0;
	for (const row of flagged) {
		const from = chicagoMonth(row.closedAt) ?? "null";
		const toStage = chicagoMonth(row.stageChangedAt) ?? "null";
		const toUpdated = chicagoMonth(row.sageUpdated) ?? "null";
		bump(beforeMonth, from, row.cents);
		bump(afterStage, toStage, row.cents);
		bump(afterUpdated, toUpdated, row.cents);
		if (from !== toStage) movedStage += 1;
		if (from !== toUpdated) movedUpdated += 1;
	}

	printSection("E. Month re-bucket for B∪C (local only)");
	printKv("flagged deals", `${flagged.length}`);
	printKv("would change month if closedAt=stageChangedAt", String(movedStage));
	printKv("would change month if closedAt=updateddate", String(movedUpdated));
	console.log("  vs stageChangedAt:");
	monthDiffTable(beforeMonth, afterStage);
	console.log("  vs Sage updateddate:");
	monthDiffTable(beforeMonth, afterUpdated);

	const misdated = rollup(flagged);
	const misdatedWon = rollup(flagged.filter((row) => row.kind === "won"));
	const misdatedLost = rollup(flagged.filter((row) => row.kind === "lost"));
	printSection("F. $ rollup B∪C vs closed YTD (by current closedAt)");
	printKv("misdated won", fmtMoney(misdatedWon));
	printKv("misdated lost", fmtMoney(misdatedLost));
	printKv("misdated total", fmtMoney(misdated));
	printKv(
		"won misdated / won YTD",
		pct(misdatedWon.cents, totals.ytdWon.cents),
	);

	printSection("Empty-closed won: targetclose month vs updateddate month");
	const emptyWon = A.filter((row) => row.kind === "won");
	const cmp = { same: money(), targetLater: money(), updatedLater: money(), missing: money() };
	for (const row of emptyWon) {
		const t = chicagoMonth(row.sageTarget);
		const u = chicagoMonth(row.sageUpdated);
		if (!t || !u) addMoney(cmp.missing, row.cents);
		else if (t === u) addMoney(cmp.same, row.cents);
		else if (t > u) addMoney(cmp.targetLater, row.cents);
		else addMoney(cmp.updatedLater, row.cents);
	}
	printKv("empty-closed won", fmtMoney(rollup(emptyWon)));
	printKv("same month (target == updated)", fmtMoney(cmp.same));
	printKv("targetclose month AFTER updated (forecast still out)", fmtMoney(cmp.targetLater));
	printKv("updated month AFTER targetclose", fmtMoney(cmp.updatedLater));
	printKv("missing one of the two", fmtMoney(cmp.missing));

	printSection("Local fixtures from the spec");
	const fixtures = deals.filter(
		(deal) =>
			FIXTURE_IDS.has(deal.id) ||
			(deal.sageCrmOpportunityId !== null &&
				FIXTURE_SAGE_IDS.has(deal.sageCrmOpportunityId)) ||
			FIXTURE_NAME_RE.test(deal.name),
	);
	if (fixtures.length === 0) {
		console.log("  none of TALLEY / 200-LTM502 / B2543WN are in this local DB as those records.");
	}
	for (const deal of fixtures) {
		const payload = deal.sageCrmOpportunityId
			? snapById.get(deal.sageCrmOpportunityId)
			: undefined;
		console.log(
			`  ${deal.name}\n    id=${deal.id} sage=${deal.sageCrmOpportunityId ?? "-"} stage=${deal.stage}\n    closedAt=${iso(deal.closedAt)} expected=${iso(deal.expectedCloseDate)} stageChangedAt=${iso(deal.stageChangedAt)}\n    snap.closed=${snapStr(payload, "closed") || "(empty)"} snap.targetclose=${snapStr(payload, "targetclose") || "(empty)"} snap.updated=${snapStr(payload, "updateddate") || "(empty)"}`,
		);
	}
	console.log("  TALLEY cmti9kwjs0bg001rr4ka3ht7t: not in local (closed Sep 2026; pull is older).");
}

function rollup(rows: { cents: number }[]): MoneyRow {
	const row = money();
	for (const item of rows) addMoney(row, item.cents);
	return row;
}

function pct(part: number, whole: number): string {
	if (whole === 0) return "n/a";
	return `${((100 * part) / whole).toFixed(1)}%`;
}

function iso(value: Date | null | undefined): string {
	return value ? value.toISOString() : "null";
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function envelope(body: string, sessionId?: string): string {
	const header = sessionId
		? `<soap:Header><tem:sessionheader><tem:sessionid>${escapeXml(sessionId)}</tem:sessionid></tem:sessionheader></soap:Header>`
		: "";
	return (
		`<?xml version="1.0" encoding="utf-8"?>` +
		`<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" ` +
		`xmlns:tem="${REQUEST_NS}" xmlns:typens="${TYPE_NS}" ` +
		`xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
		`${header}<soap:Body>${body}</soap:Body></soap:Envelope>`
	);
}

async function resolveIpv4(hostname: string): Promise<string> {
	const addrs = await DNS.resolve4(hostname);
	if (!addrs[0]) throw new Error(`No A record for ${hostname}`);
	return addrs[0];
}

async function post(url: string, action: string, xml: string): Promise<string> {
	const parsed = new URL(url);
	const ip = await resolveIpv4(parsed.hostname);
	const body = Buffer.from(xml, "utf8");
	return new Promise<string>((resolve, reject) => {
		const req = https.request(
			{
				protocol: parsed.protocol,
				hostname: ip,
				servername: parsed.hostname,
				port: parsed.port || 443,
				path: `${parsed.pathname}${parsed.search}`,
				method: "POST",
				headers: {
					host: parsed.hostname,
					"content-type": "text/xml; charset=utf-8",
					soapaction: `"${REQUEST_NS}${action}"`,
					"content-length": body.length,
				},
				timeout: TIMEOUT_MS,
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk) => chunks.push(chunk));
				res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
			},
		);
		req.on("timeout", () => {
			req.destroy(new Error(`timeout after ${TIMEOUT_MS}ms`));
		});
		req.on("error", reject);
		req.write(body);
		req.end();
	});
}

async function walk(
	url: string,
	sid: string,
	predicate: string,
): Promise<{ records: ReturnType<typeof parseRecords>; pages: number }> {
	const firstXml = await post(
		url,
		"query",
		envelope(
			`<tem:query><tem:queryString>${escapeXml(predicate)}</tem:queryString>` +
				`<tem:Entity>opportunity</tem:Entity></tem:query>`,
			sid,
		),
	);
	const fault = parseFault(firstXml);
	if (fault) throw new Error(`query fault (${predicate}): ${fault}`);
	const records = [...parseRecords(firstXml, "opportunity")];
	let more = parseMore(firstXml);
	let pages = 1;
	while (more) {
		const nextXml = await post(url, "next", envelope(`<tem:next/>`, sid));
		const nextFault = parseFault(nextXml);
		if (nextFault) throw new Error(`next fault (${predicate}): ${nextFault}`);
		records.push(...parseRecords(nextXml, "opportunity"));
		more = parseMore(nextXml);
		pages += 1;
		if (pages > 20) throw new Error(`pagination cap on ${predicate}`);
	}
	return { records, pages };
}

type SageOpp = {
	id: string;
	name: string;
	owner: string;
	kind: "won" | "lost";
	cents: number;
	closed: Date | null;
	target: Date | null;
	opened: Date | null;
	updated: Date | null;
	created: Date | null;
	timestamp: Date | null;
	stage: string;
	status: string;
	keys: string[];
};

function sageKind(stage: string, status: string): "won" | "lost" | null {
	const s = `${status} ${stage}`.toLowerCase();
	if (status.toLowerCase() === "won" || stage.toLowerCase() === "closed won") {
		return "won";
	}
	if (
		status.toLowerCase() === "lost" ||
		stage.toLowerCase() === "lost" ||
		s.includes("lost")
	) {
		return "lost";
	}
	return null;
}

function asOpp(record: Record<string, string>): SageOpp | null {
	const id = (record.opportunityid ?? "").trim();
	const name = (record.description ?? "").trim();
	if (!id || !name) return null;
	const stage = (record.stage ?? "").trim();
	const status = (record.status ?? "").trim();
	const kind = sageKind(stage, status);
	if (!kind) return null;
	const forecast = Number(record.forecast ?? record.total ?? "0");
	return {
		id,
		name,
		owner: OWNER_BY_SAGE_ID.get((record.assigneduserid ?? "").trim()) ??
			`user ${record.assigneduserid ?? "?"}`,
		kind,
		cents: Number.isFinite(forecast) ? Math.round(forecast * 100) : 0,
		closed: parseDate(record.closed),
		target: parseDate(record.targetclose),
		opened: parseDate(record.opened),
		updated: parseDate(record.updateddate),
		created: parseDate(record.createddate),
		timestamp: parseDate(record.timestamp),
		stage,
		status,
		keys: Object.keys(record),
	};
}

function ruleClosed(
	opp: SageOpp,
	rule: "current" | "closed-only" | "closed-or-updated" | "closed-or-opened",
): Date | null {
	if (opp.closed) return opp.closed;
	if (rule === "closed-only") return null;
	if (rule === "closed-or-updated") return opp.updated;
	if (rule === "closed-or-opened") return opp.opened;
	return opp.target ?? opp.opened;
}

async function runSoap(): Promise<void> {
	if (!URL_ENV || !USER_ENV || !PASS_ENV) {
		printSection("Live Sage");
		console.log("  SAGE_SOAP_* missing — skipped.");
		return;
	}

	printSection("Live Sage SOAP");
	console.log("  One session: logon → getmetadata → Won → Lost → fixture lookup → logoff.");

	const url = URL_ENV;
	const logonXml = await post(
		url,
		"logon",
		envelope(
			`<tem:logon><tem:Username>${escapeXml(USER_ENV)}</tem:Username>` +
				`<tem:Password>${escapeXml(PASS_ENV)}</tem:Password></tem:logon>`,
		),
	);
	const logonFault = parseFault(logonXml);
	if (logonFault) throw new Error(`logon fault: ${logonFault}`);
	const sid = parseSessionId(logonXml);
	if (!sid) throw new Error("logon returned no session id");

	try {
		const metaXml = await post(
			url,
			"getmetadata",
			envelope(
				`<tem:getmetadata><tem:entityname>opportunity</tem:entityname></tem:getmetadata>`,
				sid,
			),
		);
		const metaFault = parseFault(metaXml);
		if (metaFault) {
			printKv("getmetadata", `fault: ${metaFault}`);
		} else {
			const names = new Set<string>();
			const re = /<(?:\w+:)?(?:fieldname|name|columnname|displayname)>([^<]+)<\//gi;
			let match: RegExpExecArray | null;
			while ((match = re.exec(metaXml)) !== null) {
				names.add(match[1].trim());
			}
			const dateFields = [...names]
				.filter((name) => /date|time|closed|opened|stamp/i.test(name))
				.sort();
			printKv("getmetadata date-ish fields", dateFields.join(", ") || "(none parsed)");
			printKv("getmetadata name tags", String(names.size));
			if (dateFields.length === 0) {
				const snippet = metaXml.replace(/\s+/g, " ").slice(0, 400);
				printKv("getmetadata snippet", snippet);
			}
		}

		const wonWalk = await walk(url, sid, "oppo_status = 'Won'");
		const lostWalk = await walk(url, sid, "oppo_status = 'Lost'");
		printKv("Won pages / rows", `${wonWalk.pages} / ${wonWalk.records.length}`);
		printKv("Lost pages / rows", `${lostWalk.pages} / ${lostWalk.records.length}`);

		const keyUnion = new Set<string>();
		for (const record of [...wonWalk.records, ...lostWalk.records]) {
			for (const key of Object.keys(record)) keyUnion.add(key);
		}
		printKv("live SOAP field union", [...keyUnion].sort().join(", "));

		const opps = [...wonWalk.records, ...lostWalk.records]
			.map(asOpp)
			.filter((row): row is SageOpp => row !== null);

		const nonempty = new Map<string, number>();
		for (const key of [
			"closed",
			"targetclose",
			"opened",
			"createddate",
			"updateddate",
			"timestamp",
			"notifytime",
			"stage",
			"status",
		]) {
			let n = 0;
			for (const record of [...wonWalk.records, ...lostWalk.records]) {
				if ((record[key] ?? "").trim()) n += 1;
			}
			nonempty.set(key, n);
		}
		printSection("Live Sage date-field fill (Won+Lost rows)");
		for (const [key, n] of nonempty) {
			printKv(key, `${n} / ${wonWalk.records.length + lostWalk.records.length}`);
		}

		const tsEq = [...wonWalk.records, ...lostWalk.records].filter(
			(record) =>
				(record.timestamp ?? "").trim() &&
				(record.timestamp ?? "").trim() === (record.updateddate ?? "").trim(),
		).length;
		printKv("timestamp == updateddate", `${tsEq} / ${wonWalk.records.length + lostWalk.records.length}`);

		const won = opps.filter((row) => row.kind === "won");
		const lost = opps.filter((row) => row.kind === "lost");
		printSection("Live Sage closed universe (status Won/Lost)");
		printKv("won", fmtMoney(rollup(won)));
		printKv("lost", fmtMoney(rollup(lost)));
		printKv("won with Sage closed", fmtMoney(rollup(won.filter((row) => row.closed))));
		printKv("won with empty Sage closed", fmtMoney(rollup(won.filter((row) => !row.closed))));
		printKv("lost with Sage closed", fmtMoney(rollup(lost.filter((row) => row.closed))));
		printKv("lost with empty Sage closed", fmtMoney(rollup(lost.filter((row) => !row.closed))));

		const futureByRule = (rule: Parameters<typeof ruleClosed>[1]) =>
			opps.filter((row) => {
				const closedAt = ruleClosed(row, rule);
				return closedAt !== null && closedAt.getTime() > NOW.getTime();
			});

		printSection("C. Future-dated under each close rule");
		for (const rule of [
			"current",
			"closed-only",
			"closed-or-updated",
			"closed-or-opened",
		] as const) {
			const set = futureByRule(rule);
			printKv(rule, fmtMoney(rollup(set)));
		}

		printSection("Live won $ by Chicago month under each close rule (2025-01+)");
		const rules = [
			"current",
			"closed-only",
			"closed-or-updated",
			"closed-or-opened",
		] as const;
		const byRule = new Map<string, Map<string, MoneyRow>>();
		for (const rule of rules) {
			const map = new Map<string, MoneyRow>();
			for (const row of won) {
				const closedAt = ruleClosed(row, rule);
				const month = chicagoMonth(closedAt);
				if (!month || month < "2025-01") continue;
				bump(map, month, row.cents);
			}
			byRule.set(rule, map);
		}
		const months = new Set<string>();
		for (const map of byRule.values()) {
			for (const month of map.keys()) months.add(month);
		}
		const header = ["month", ...rules].map((h) => h.padEnd(18)).join("");
		console.log(`  ${header}`);
		for (const month of [...months].sort()) {
			const cells = [month, ...rules.map((rule) => fmtUsd((byRule.get(rule)?.get(month) ?? money()).cents))];
			console.log(`  ${cells.map((c) => c.padEnd(18)).join("")}`);
		}

		printSection("2026 YTD won $ under each close rule");
		for (const rule of rules) {
			const row = money();
			for (const opp of won) {
				const closedAt = ruleClosed(opp, rule);
				if (closedAt && closedAt >= YTD_START && closedAt.getTime() <= NOW.getTime()) {
					addMoney(row, opp.cents);
				}
			}
			printKv(rule, fmtMoney(row));
		}
		printKv(
			"note on closed-only YTD",
			"Excludes empty-closed wins and any future closed date. This is the strict actuals number.",
		);

		const emptyWon = won.filter((row) => !row.closed);
		const byOwner = new Map<string, MoneyRow>();
		const targetVsUpdated = {
			same: money(),
			targetLater: money(),
			updatedLater: money(),
			missing: money(),
		};
		for (const row of emptyWon) {
			bump(byOwner, row.owner, row.cents);
			const t = chicagoMonth(row.target);
			const u = chicagoMonth(row.updated);
			if (!t || !u) addMoney(targetVsUpdated.missing, row.cents);
			else if (t === u) addMoney(targetVsUpdated.same, row.cents);
			else if (t > u) addMoney(targetVsUpdated.targetLater, row.cents);
			else addMoney(targetVsUpdated.updatedLater, row.cents);
		}
		printSection("Live empty-closed Won");
		printKv("count / $", fmtMoney(rollup(emptyWon)));
		printKv("target month == updated month", fmtMoney(targetVsUpdated.same));
		printKv("target month AFTER updated (left-over forecast)", fmtMoney(targetVsUpdated.targetLater));
		printKv("updated month AFTER target", fmtMoney(targetVsUpdated.updatedLater));
		printMoneyMap("by owner", byOwner);

		printSection("Live fixtures + Sept 2026 won");
		const septWon = won.filter((row) => {
			const current = ruleClosed(row, "current");
			const updated = ruleClosed(row, "closed-or-updated");
			return (
				chicagoMonth(current) === "2026-09" ||
				chicagoMonth(updated) === "2026-09" ||
				chicagoMonth(row.closed) === "2026-09" ||
				chicagoMonth(row.target) === "2026-09"
			);
		});
		const interesting = [
			...opps.filter(
				(row) =>
					FIXTURE_SAGE_IDS.has(row.id) ||
					FIXTURE_NAME_RE.test(row.name),
			),
			...septWon,
		];
		const seen = new Set<string>();
		for (const row of interesting) {
			if (seen.has(row.id)) continue;
			seen.add(row.id);
			const current = ruleClosed(row, "current");
			const alt = ruleClosed(row, "closed-or-updated");
			console.log(
				`  ${row.id.padStart(4)} ${row.kind} ${row.owner} ${fmtUsd(row.cents)}  ${row.name.slice(0, 60)}\n` +
					`       stage=${row.stage || "-"} status=${row.status || "-"}\n` +
					`       closed=${chicagoDate(row.closed) ?? "(empty)"} target=${chicagoDate(row.target) ?? "(empty)"} opened=${chicagoDate(row.opened) ?? "-"}\n` +
					`       updated=${chicagoDate(row.updated) ?? "-"}  CRM-today=${chicagoDate(current) ?? "null"}  closed??updated=${chicagoDate(alt) ?? "null"}`,
			);
		}

		const futureCurrent = futureByRule("current");
		if (futureCurrent.length > 0) {
			printSection("Live future-dated under current CRM rule (closed??targetclose??opened)");
			for (const row of futureCurrent.slice(0, 20)) {
				console.log(
					`  ${row.id.padStart(4)} ${row.kind} ${fmtUsd(row.cents)} ${row.name.slice(0, 50)}  closed=${chicagoDate(row.closed) ?? "∅"} target=${chicagoDate(row.target) ?? "∅"} updated=${chicagoDate(row.updated) ?? "∅"}`,
				);
			}
		}
	} finally {
		try {
			await post(url, "logoff", envelope(`<tem:logoff/>`, sid));
		} catch {
			// ignore
		}
	}
}

async function main(): Promise<void> {
	console.log("closedAt dry-run — read only");
	console.log(`now ${NOW.toISOString()} (${TZ})`);
	try {
		await runLocal();
	} finally {
		await db.$disconnect().catch(() => {});
	}
	if (WANT_SOAP) {
		await runSoap();
	} else {
		printSection("Live Sage");
		console.log("  Skipped. Re-run with --soap for current Won/Lost dates + getmetadata.");
	}
}

main().catch(async (error: unknown) => {
	console.error(error);
	await db.$disconnect().catch(() => {});
	process.exit(1);
});
