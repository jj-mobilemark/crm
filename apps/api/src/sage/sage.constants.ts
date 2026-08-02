/**
 * Sage CRM SOAP constants. See `docs/plans/sage-crm-sync.md`.
 *
 * The eware.dll web service answers only real SOAP POSTs (a GET returns an
 * empty body). Requests use the `http://tempuri.org/` namespace; responses come
 * back under `http://tempuri.org/type`. A `logon` returns a session id that
 * every later call carries in a `sessionheader` SOAP header.
 */

export const SAGE_REQUEST_NS = "http://tempuri.org/";

/** The three core entities this sync reads. */
export const SAGE_ENTITIES = ["company", "person", "opportunity"] as const;
export type SageEntity = (typeof SAGE_ENTITIES)[number];

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
