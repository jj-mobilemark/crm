/**
 * Sage CRM SOAP constants. See `docs/plans/sage-crm-sync.md`.
 *
 * The eware.dll web service answers only real SOAP POSTs (a GET returns an
 * empty body). Requests use the `http://tempuri.org/` namespace; responses come
 * back under `http://tempuri.org/type`. A `logon` returns a session id that
 * every later call carries in a `sessionheader` SOAP header.
 */

export const SAGE_REQUEST_NS = "http://tempuri.org/";

/**
 * The response / complex-type namespace. Reads come back as `typens:<field>`
 * and writes must send typed records (`xsi:type="typens:<entity>"`) with
 * `typens:`-prefixed field children. Confirmed against production (Phase 0).
 */
export const SAGE_TYPE_NS = "http://tempuri.org/type";

/** The three core entities this sync reads. */
export const SAGE_ENTITIES = ["company", "person", "opportunity"] as const;
export type SageEntity = (typeof SAGE_ENTITIES)[number];

/**
 * One field on a Sage write, using the SHORT field name Sage returns on a read
 * (e.g. `description`, `forecast`, `opportunityid`) — NOT the prefixed
 * predicate column. An `update` set must include the entity's id field.
 */
export type SageWriteField = { name: string; value: string };

/**
 * Sage caps a query at ~100 rows regardless of the predicate. The full pull
 * pages by ascending id (`<idcol> > lastSeenId`) until a page returns fewer
 * than this. Confirmed empirically: two wide queries each returned exactly 100.
 */
export const SAGE_QUERY_PAGE_SIZE = 100;

/** Per-entity primary-key column, used both to page and to read the id back. */
export const SAGE_ID_COLUMN: Record<SageEntity, string> = {
	company: "comp_companyid",
	person: "pers_personid",
	opportunity: "oppo_opportunityid",
};

/** The "last changed" column every entity carries; the incremental cursor. */
export const SAGE_UPDATED_COLUMN: Record<SageEntity, string> = {
	company: "comp_updateddate",
	person: "pers_updateddate",
	opportunity: "oppo_updateddate",
};

// --- Mobile Mark test slice (docs/plans/sage-crm-sync.md section 2) ----------

/** The first import is bounded to a handful of our own test companies. */
export const SAGE_TEST_COMPANY_LIMIT = 10;

/** Seed filter for the test slice — our own company, in its many variations. */
export const SAGE_TEST_NAME_PREDICATE = "comp_name like 'Mobile Mark%'";

/**
 * A company confirmed to carry opportunities, force-included so the slice always
 * has real deal data to map (MOBILE MARK INC).
 */
export const SAGE_TEST_OPPORTUNITY_COMPANY_ID = "24";

export const SAGE_REQUEST_TIMEOUT_MS = 40_000;

// --- full pull / backfill (docs/plans/sage-crm-sync.md section 6) ------------

/**
 * Postgres advisory-lock key for "a Sage session is open".
 *
 * ONE Web Services session may exist globally (a second `logon` kicks the
 * first), so the test-slice, the backfill, the nightly cron, and the deferred
 * push all take this single lock before touching Sage. Arbitrary but fixed —
 * changing it would let two holders coexist.
 */
export const SAGE_SESSION_LOCK_KEY = 742_000_777;

/**
 * Pause between Sage pages during the backfill.
 *
 * This is a live production server the sales team uses; a small delay keeps the
 * walk from hammering it. The API's own ~10-20s/page dominates anyway.
 */
export const SAGE_PAGE_DELAY_MS = 400;

/** How many company pages a single backfill run will walk (safety ceiling). */
export const SAGE_MAX_BACKFILL_PAGES = 400;

/**
 * Overlap subtracted from the high-water before an incremental pull, so a row
 * changed during the previous run is not missed. Idempotent upserts absorb the
 * re-read.
 */
export const SAGE_INCREMENTAL_OVERLAP_MS = 60 * 60 * 1000;

/**
 * How many times an incremental walk may re-logon and restart after Sage
 * drops the session mid-`next` (e.g. "You are not logged on."). Pagination
 * is session-stateful, so a lost session cannot resume — only restart.
 */
export const SAGE_SESSION_RESTART_LIMIT = 2;

/**
 * True when a SOAP fault means the Web Services session is gone.
 *
 * A second `logon` elsewhere kicks the first; idle timeouts also drop it.
 * `next` cannot recover — the caller must re-query from the start.
 */
export function isSageSessionLost(reason: string | undefined): boolean {
	if (!reason) return false;
	const lower = reason.toLowerCase();
	return (
		lower.includes("not logged on") ||
		lower.includes("not logged in") ||
		lower.includes("session has expired") ||
		lower.includes("invalid session")
	);
}
