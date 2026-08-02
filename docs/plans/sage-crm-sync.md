# Sage CRM sync — Phase 7 (canonical plan)

This is the canonical Phase 7 doc referenced by the stub in
[docs/plans/m365-expansion.md](m365-expansion.md). First cut is **pull only**
for the **Company / Person / Opportunity** triad. Push (local -> Sage) is a
later phase; this cut builds the groundwork (external-id columns, raw
snapshots, and the field-mapping catalog below) so push is mechanical later.

Scope is intentionally small first: a **bounded test slice** (the Mobile Mark
records) so we can plan around real data before the full pull.

---

## 1. SOAP access — CONFIRMED (2026-08-02, 7.0 probe)

The live endpoint works. All facts below were verified against production.

- **Endpoint**: `SAGE_SOAP_URL` = `https://crm.mobilemark.com/crm/eware.dll/WebServices/SOAP`
  (creds: `SAGE_SOAP_USER` / `SAGE_SOAP_PASSWORD`, service account "Chris").
- **Transport**: SOAP 1.1 over HTTPS. GET returns HTTP 200 with a 0-byte body —
  the DLL only answers real SOAP POSTs. WSDL retrieval returned empty, so we
  build envelopes by hand (do NOT depend on a fetched WSDL).
- **Request namespace**: `http://tempuri.org/`. **Response type namespace**:
  `http://tempuri.org/type`.
- **`logon`**: body `logon { Username, Password }` -> `logonresponsetype` with
  `result/sessionid`. Session id is passed on every later call via a SOAP
  header `sessionheader { sessionid }`.
- **`query`**: body `query { queryString, Entity }` -> `queryresponse` with
  `result/records[]`, each `records xsi:type="typens:<entity>"`.
- **`logoff`**: body `logoff` (session header) -> `logoffresponsetype/success`.
- **Predicates use DB column names** (prefixed: `comp_`, `pers_`, `oppo_`),
  e.g. `comp_name like 'Mobile Mark%'`, `pers_companyid = 24`,
  `oppo_primarycompanyid = 24`. **Responses use SHORT field names** (no prefix),
  e.g. `<typens:companyid>`, `<typens:name>`. This asymmetry matters: query by
  `comp_*`, read back plain names.
- **Cursor field**: every entity has `updateddate` (ISO local, e.g.
  `2026-07-30T16:50:58`). The full pull cursor is `<entity>_updateddate > '<last>'`.
- **RESULTS ARE CAPPED AT ~100 PER CALL.** Two different wide queries each
  returned exactly 100 records — Sage caps web-service query results (default
  `maxrecords` ~100). **The full pull MUST paginate.** Practical approach: page
  by ascending id, `<entity>_<idcol> > <lastSeenId>` (e.g.
  `oppo_opportunityid > 0`, then `> 100`, …), 100 at a time, until a page
  returns < 100. Combine with the `updateddate` cursor for incremental runs
  (records ordered by id within the changed set). Do NOT assume a single query
  returns everything — that is the biggest correctness trap here.

### Entity availability

Two distinct error strings tell us different things:

- **"Entity '<x>' is not Web Service enabled"** = the module exists in Sage but
  is NOT exposed. Cannot be reached until an admin enables it (same switch
  `MasHeader` got). Confirmed OFF: `forecast`, `campaign`.
- **"Query failed to run successfully"** = the entity IS exposed, but our
  predicate/id-column was wrong. Confirmed on: `case`, `quotes`, `orders`,
  `user`. These are probably reachable with the right id column — re-probe
  before assuming they are unavailable.

| Entity | Web-service | Notes |
| --- | --- | --- |
| `company` | **yes** | HIERARCHICAL doc: nests `address`, `phone`, `email`, `person` children (association is by XML nesting, not an FK field). |
| `person` | **yes** | **Flat**; carry `emailaddress` and `areacode`/`number` inline. Query with `pers_companyid = <id>`. |
| `opportunity` | **yes** | Flat; `oppo_primarycompanyid` links to company. Carries the forecasting fields (see section 3b). |
| `communication` | **yes** | Sage activities (calls, meetings, tasks, letters). Maps to the local `Activity` timeline — a big win for the interface layer. Not in the v1 triad; strong candidate for phase 2. |
| `lead` | **yes** | Sage leads (pre-qualification). No local equivalent today. |
| `case` / `quotes` / `orders` / `user` | **likely yes** | Returned "Query failed" (wrong id column), not "not enabled". Re-probe with correct columns. `user` matters for owner mapping. |
| `forecast` | **NO** | "not Web Service enabled". Sage's formal Forecast submissions are unreachable — forecasting must be reconstructed from `opportunity` (section 3b). |
| `campaign` | **NO** | "not Web Service enabled". Out of scope. |

### Decision that follows from the probe

Pull each entity **flat and separately** (`company` header, then `person` by
`pers_companyid`, then `opportunity` by `oppo_primarycompanyid`). Do NOT rely on
the deep nested `company` response — flat person/opportunity queries give the
same data with a far simpler parser and smaller payloads. Store the raw XML
(or parsed JSON) per record in `SageRecordSnapshot` regardless, so no field is
lost before it is mapped.

---

## 2. Test slice (first import) — the Mobile Mark records

`comp_name like 'Mobile Mark%'` matched **8 companies** (under the 10 cap):

| companyid | name | mas_customerno | has opps |
| --- | --- | --- | --- |
| 4139 | MOBILE MARK (EUROPE) LTD | MME | — |
| 4143 | Mobile Mark (Europe) Ltd | — | — |
| 9677 | Mobile Mark eStore | — | — |
| 24 | MOBILE MARK INC | 0000777 | **yes (4)** |
| 4145 | Mobile Mark, Inc | — | — |
| 4146 | Mobile Mark, Inc | — | — |
| 4153 | Mobile Mark, Inc | — | — |
| 4214 | Mobile Mark, Inc | — | — |

Company **24 (MOBILE MARK INC)** is the guaranteed opportunity example. Its 4
opportunities include real data:

- `383` — "249  PR-LTMWG944-SP716" — stage `Closed Won`, status `Won`,
  forecast `81008.4`, certainty `100`.
- `557` — "Jordan Test Push From Sales Tool" — stage `Lost`, status `Closed`.
- `1`, `2` — "test" / "Test2" — blank stage/status (legacy test rows).

The slice import: for each of the 8 companyids, pull the company header, all
`person` where `pers_companyid=<id>`, and all `opportunity` where
`oppo_primarycompanyid=<id>`; snapshot everything; map into local
Company/Contact/Deal. Then inspect the results (especially the opportunity ->
Deal mapping) before committing the full pull.

---

## 3. Field-mapping catalog

Only the fields Sage **owns** are mapped onto local records. Agent-owned
enrichment fields (`logoUrl`, `industry`, `brief`, socials) are never touched by
a pull. `source` is set to `RecordSource.SAGE` on new rows.

### 3.1 company -> `Company`

| Local field | Sage source | Transform / note |
| --- | --- | --- |
| `sageCrmCompanyId` | `companyid` | new `@unique` column; the Sage CRM join key (e.g. `4139`, `24`) |
| `sage100CustomerNo` | `mas_customerno` | **Sage 100 customer number** (e.g. `0000777`, `MME`). Surfaced in the UI (section 3d). |
| `sage100ArDivisionNo` | `mas_ardivisionno` | Sage 100 AR division (e.g. `00`). Together with `sage100CustomerNo` this is the Sage 100 customer key and the join to `MasHeader` / `MasOrderDetailHistory`. Display combined as `<div>-<no>` (e.g. `00-0000777`). |
| `name` | `name` | |
| `domain` | `website` | parse host; else domain of primary `person.emailaddress`. Used to match an existing local company before creating one. |
| `website` | `website` | as-is |
| `city` | nested `address.city` / `city` | primary address |
| `stateCode` | nested `address.state` | Sage stores free-text state, not a code — keep as-is |
| `country` / `countryCode` | nested `address.country` / `phone.countrycode` | |
| `phone` | nested `phone.areacode` + `number` | primary phone |
| `email` | nested `email.emailaddress` | primary email |
| `source` | — | constant `SAGE` |

Sage `type` (Customer/…), `status`, `pysales`/`openorders`/`annualizedsales`
etc. are sales metrics — kept in the snapshot, not mapped to core columns in v1.
(The two Sage 100 fields are promoted from snapshot-only to real columns because
the sales team needs them visible/copyable — section 3d.)

### 3.2 person -> `Contact`

| Local field | Sage source | Transform / note |
| --- | --- | --- |
| `sageCrmContactId` | `personid` | new `@unique` column; the contact's Sage CRM id (e.g. `5`) |
| `firstName` | `firstname` | |
| `lastName` | `lastname` | |
| `email` | `emailaddress` | may be blank; also `@unique` on local Contact — de-dupe against existing contacts |
| `phone` | `areacode` + `number` | |
| `title` | `title` | |
| `companyId` | `companyid` | resolve to the local company created/matched from that Sage companyid |
| `source` | — | constant `SAGE` |

**Contact Sage 100 id.** Sage 100 keys *customers* (companies), not individual
contacts — the person's `mas_customerno`/`mas_ardivisionno` are inherited from
its company. So a contact does NOT get its own Sage 100 column; its "Sage 100
ID" is the parent company's, read through the `company` relation and shown on the
contact (section 3d). If a per-contact Sage 100 code (AR contact code) turns out
to be exposed later, add `sage100ContactCode` then.

### 3.3 opportunity -> `Deal`

| Local field | Sage source | Transform / note |
| --- | --- | --- |
| `sageCrmOpportunityId` | `opportunityid` | new `@unique` column (also the provenance marker; Deal has no `source`). Opportunities are Sage CRM only — no Sage 100 id. |
| `name` | `description` | |
| `companyId` | `primarycompanyid` | resolve to local company |
| `amount` | `total` | DECIDED: `total` (unweighted). `forecast` -> weighted field (3b). |
| `currency` | `currency` | default `USD` if blank |
| `stage` | `stage` + `status` | map to `DealStage` (see below) |
| `expectedCloseDate` | `targetclose` | |
| `closedAt` | `closed` | |
| `ownerId` | `assigneduserid` | **REQUIRED locally, but unmappable via SOAP** (no `user` entity). See open items — needs a fallback owner. |

**Stage mapping (`DealStage`).** Sage stage/status vocabulary enumerated from a
100-opportunity sample:

- stage: `Investigation/Prospecting`, `Proposal`, `Negotiation`, `Purchasing`,
  `Closed Won`, `Lost`, (blank)
- status: `In Progress`, `Won`, `Lost`, `Closed`

The local `DealStage` enum is a HubSpot-style pipeline
(`DEMO_BOOKED`, `QUALIFIED_TO_BUY`, `UNQUALIFIED_TO_BUY`,
`DECISION_MAKER_BOUGHT_IN`, `CONTRACT_SENT`, `CLOSED_WON`, `CLOSED_LOST`) that
does NOT match Sage's process.

**DECIDED (2026-08-02): option B — adopt Sage's stages as the local pipeline.**
Replace the `DealStage` enum with Sage's stage set and re-key the deal board
columns so the app mirrors how the team actually works. Keep the raw Sage
`stage`/`status` in the snapshot regardless.

Active stage values (seen across two 100-row samples — but note the 100-record
cap means history is not fully enumerated): `Investigation/Prospecting`,
`Proposal`, `Negotiation`, `Purchasing`, `Closed Won`, `Lost`. Proposed enum:

```
enum DealStage {
  INVESTIGATION_PROSPECTING
  PROPOSAL
  NEGOTIATION
  PURCHASING
  CLOSED_WON
  LOST
}
```

Because of the query cap, a rare legacy stage could exist that these samples
missed. Keep the raw Sage `stage`/`status` in the snapshot and treat any
unknown stage as a safe default (do not fail the import). Confirm the complete
list against the Sage opportunity workflow definition before the migration is
final.

Impact of adopting: the `DealStage` enum in `packages/db/prisma/schema.prisma`,
the deal-board column keys (`apps/app/components/crm/deal-stage.tsx` and the
board page), and any code branching on the old values all change. This is a
schema + UI change, planned deliberately.

---

## 3b. Forecasting — what it is in Sage, and the gap here

The team forecasts in Sage. Forecasting there is NOT a separate record type we
can sync: the dedicated `forecast` entity is **not Web Service enabled**. Sage
sales forecasting is driven by the **opportunity** itself. The relevant fields
(all confirmed present and populated):

- `forecast` — the forecast (weighted) revenue amount.
- `total` — the opportunity total (unweighted deal value).
- `certainty` — probability %, real values seen: `0,10,25,50,75,90,100`.
- `stage` / `status` — pipeline position.
- `targetclose` — the period the revenue lands in (the axis a forecast is built on).
- `type` — `Key Opportunity` / `New Business` / `Baseline Business`.

A Sage forecast is essentially: **sum of `forecast` (or `total` x `certainty`)
for open opportunities, grouped by `targetclose` period and rep**. So we can
fully reconstruct forecasting from opportunity data — but only if we bring those
fields across.

**DECIDED (2026-08-02): forecasting is IN the first cut** — add the fields in
7.1, map them, and build a forecast view.

**The gap:** the local `Deal` model has `amount`, `stage`, `expectedCloseDate`
and nothing else. It has **no probability/certainty, no weighted-forecast value,
no deal type, and no pipeline/forecast reporting**. As-is, this app cannot show
the team their forecast — the single thing they rely on Sage for. To be a real
interface improvement layer, `Deal` needs (all additive):

- `probability Int?` (<- `certainty`)
- `weightedAmount` / `forecastAmount Decimal?` (<- `forecast`; or derive
  `amount * probability`)
- `dealType String?` (<- opportunity `type`)
- and the UI needs a **forecast view**: pipeline by close month, weighted vs
  unweighted, per rep — none of which exists today.

For **bidirectional** later: reps forecasting in THIS app means writing
`stage`, `certainty`, `forecast`, `targetclose` back onto the Sage opportunity
via SOAP `update`. That is exactly how Sage's own forecast recomputes, so no
`forecast`-entity access is needed.

## 3c. Feature-completeness check (are we missing crucial things?)

Beyond the triad, these Sage capabilities exist and matter for an interface
layer. Decide which are in scope:

| Sage capability | WS status | Local equivalent | Recommendation |
| --- | --- | --- | --- |
| **Forecasting** (opportunity-driven) | via `opportunity` | none | **In scope** — extend `Deal` + build a forecast view (section 3b). This is the headline risk. |
| **Activities / communications** (calls, meetings, tasks, letters) | `communication` enabled | `Activity` | **Strong phase-2 candidate** — an interface layer without the interaction history is thin. |
| **Order / invoice history** (Sage 100) | `MasHeader` + `MasOrderDetailHistory` enabled | none | Read-only context on the company via `mas_customerno` join. Later phase. |
| **Quotes / Sales Orders** | probably enabled (re-probe) | none | Optional; overlaps with Mas* order history. |
| **Leads** | `lead` enabled | none (Screening Room is the nearest) | Decide: map to Contact, or skip. |
| **Cases** (service) | probably enabled (re-probe) | none | Out of scope for a sales layer unless asked. |
| **Formal Forecast submissions** | `forecast` NOT enabled | n/a | Not syncable; reconstruct from opportunities. |
| **Campaigns** | `campaign` NOT enabled | n/a | Out of scope. |

## 3d. Surfacing Sage IDs in the UI (sales-team ask)

The team needs both id systems visible and one-click copyable — in list tables
and on record pages. Two distinct ids per company:

- **Sage CRM ID** — the eware entity id (`companyid` / `personid` /
  `opportunityid`). Used to deep-link into Sage CRM and for support.
- **Sage 100 ID** — the ERP customer number (`ardivisionno` + `customerno`,
  shown as `00-0000777`). Used by finance/ops and to tie back to orders.

### Schema (folds into 7.1)

- `Company`: `sageCrmCompanyId`, `sage100CustomerNo`, `sage100ArDivisionNo`.
- `Contact`: `sageCrmContactId` (its own Sage CRM id). No Sage 100 column — a
  contact's Sage 100 id is the parent company's, shown via the relation.
- `Deal`: `sageCrmOpportunityId` (already planned).

### API (thin, mechanical)

- Add the id fields to `CompanyRow` / `ContactRow` `list()` selects and to
  `companies.byId` / `contacts.byId`
  ([apps/api/src/companies/companies.service.ts](../../apps/api/src/companies/companies.service.ts),
  [apps/api/src/contacts/contacts.service.ts](../../apps/api/src/contacts/contacts.service.ts)).
- Extend the contact's nested `company` select (`COMPANY_SELECT`) to include
  `sageCrmCompanyId` + the two Sage 100 fields, so the contact page and the
  contacts table can show the PARENT company's ids.

### UI

- **New primitive** `CopyButton` in `packages/ui`
  ([packages/ui/src/components/data-table.tsx](../../packages/ui/src/components/data-table.tsx)
  is the neighbour pattern; there is no copy component today). Icon-only
  (Carbon `Copy`) + `sonner` toast; `packages/ui` is the only source of UI, so
  it lives there, no call-site style overrides.
- **List columns** (`companies-table.tsx`, `contacts-table.tsx`): add
  "Sage CRM ID" and "Sage 100 ID" columns using the `DataTableColumn` shape,
  `defaultHidden: true` (opt-in via the Columns menu; non-sortable unless we add
  it to `SORTABLE`). Cell = id text + `CopyButton`. Contacts table reads the
  Sage 100 id from `row.company`.
- **Company sheet** ([company-sheet.tsx](../../apps/app/components/crm/record-sheet/company-sheet.tsx)
  `CompanyOverview` Details rail): a small `DetailSheetSection title="Sage"`
  with read-only `DetailSheetProperty` rows for Sage CRM ID and Sage 100 ID,
  each with a `CopyButton`. Read-only (`DetailSheetProperty`), not `InlineField`
  — reps copy, they don't hand-edit ids.
- **Contact sheet** ([contact-sheet.tsx](../../apps/app/components/crm/record-sheet/contact-sheet.tsx)
  `ContactOverview` Details): a "Sage" section with the contact's own Sage CRM
  ID, plus the parent company's Sage CRM ID and Sage 100 ID (from
  `contact.company`), all copyable — exactly the "easy copy/paste of parent
  company sage ids" ask.

### Build order note

This UI slice depends on 7.1 (columns) + 7.4a (real data to show). Build it
right after the test-slice import so the team can eyeball real ids on the Mobile
Mark records.

## 4. Open items (decide at build time; record in HANDOFF.md)

1. **Owner mapping — DECIDED: static map.** Use a hardcoded
   `sageUserId -> local User email` map in Sage config; unmapped owners fall to
   a designated default (`Deal.ownerId` is required). **BLOCKING INPUT NEEDED:**
   the human will supply the Sage-user -> email list. The Sage user ids appear
   as `assigneduserid` (opportunity) and `primaryuserid` (company/person).
2. **Deal amount source — DECIDED:** `Deal.amount` <- opportunity `total`
   (unweighted); `forecast` -> the new weighted field (section 3b).
3. **Stage model — DECIDED: adopt Sage's stages (option B, section 3.3).**
   Still need the FULL stage vocabulary before finalizing the enum.
4. **Forecasting — DECIDED: in the first cut** (section 3b).
5. **Which extra modules** to bring in (order of value): communications ->
   order history -> leads -> quotes/cases. Confirm with the team. (Not blocking
   the triad.)
6. **Domain collisions**: several Mobile Mark companies share the same name and
   likely the same web domain (`Company.domain` is `@unique`). Matching by
   domain will collapse them; match by `sageCrmCompanyId` FIRST, fall back to
   domain only when no sageId match, and allow `domain` to be null to avoid
   unique-constraint clashes across the 8 near-duplicates.
7. **Network reachability** of `crm.mobilemark.com` from the deploy environment
   (worked from this machine; confirm from Vercel/Railway; watch for IP
   allowlists).
8. **Later: Sage 100 order history.** `MasHeader` (open-order headers) and
   `MasOrderDetailHistory` (invoice/shipment lines) join to a company via
   `mas_ardivisionno` + `mas_customerno` (kept in the company snapshot). A
   read-only order-history view is a natural follow-on phase.

---

## 5. Build phases

**Status (2026-08-02):** 7.1 schema (minus Deal changes), 7.2 config + SOAP
client, and 7.3 mappings + owner map are DONE and green (check-types / lint /
test). Deferred deliberately: the `DealStage` enum swap + Deal forecasting
fields (high blast radius on the board UI) and everything deal-related, plus the
test-slice import route (7.4a) and the id-surfacing UI (7.4c). Next agent starts
at 7.4a.

1. **7.1 Schema** (additive): `RecordSource.SAGE`; ids —
   `Company.sageCrmCompanyId`, `Contact.sageCrmContactId`,
   `Deal.sageCrmOpportunityId` (all `String? @unique`), plus
   `Company.sage100CustomerNo` + `Company.sage100ArDivisionNo` (section 3d);
   the adopted `DealStage` enum (section 3.3) replacing the old values;
   forecasting fields on `Deal` (`probability Int?`, `weightedAmount Decimal?`,
   `dealType String?` — section 3b); `SageSyncState` (per-entity cursor, mirrors
   `MailboxSync`); `SageRecordSnapshot` (`entity`, `sageId`, `payload Json`,
   `@@unique([entity, sageId])`). Migration `add_sage_sync`.
2. **7.2 Config + client**: `SAGE_SOAP_*` already in `.env` (add to
   `.env.example` + `env.validation.ts`, all-or-none capability helper).
   `apps/api/src/sage/sage-soap.client.ts`: logon/session cache + re-logon,
   `query(entity, predicate)`, `SageResult<T>` (never throws; mirrors
   `GraphApiClient`).
3. **7.3 Mapping catalog**: `apps/api/src/sage/sage.mappings.ts` from section 3.
4. **7.4a Test-slice import**: on-demand route/mutation that imports the 8
   Mobile Mark companyids (+ their people + opportunities) with snapshots.
5. **7.4c Sage-ID UI** (section 3d): `CopyButton` primitive in `packages/ui`;
   id fields on `list()`/`byId` selects (+ contact's nested company); Sage
   columns on the companies/contacts tables; a "Sage" section on the company +
   contact sheets. Build right after the slice so real ids are visible.
6. **7.4b Full pull at scale**: `sage-pull.service.ts` — the resumable,
   throttled, two-phase (backfill -> incremental) state machine in **section 6**
   (27k+ rows; ~100/page; parent-before-child; off-peak throttling; idempotent
   upserts). Extends `SageSyncState` (phase/backfillId/highWater — section 6.2).
   `sage-sync.service.ts` orchestrator with a per-tick budget; `/internal/sync/sage`
   cron route (CRON_SECRET); `sage.router.ts` (`status` exposing phase+progress,
   `syncNow`); register in `app.module.ts`, regenerate + commit `server.ts`.
7. **Deferred (push)**: `SageOutbox` + `sage-push.service.ts` + create hooks.

---

## 6. Scale: backfill + progressive incremental sync

Production Sage holds roughly **27k companies and ~14k people** (plus
opportunities). That rules out any "one query = everything" design on two counts:
Sage caps a query at ~100 rows, and we must not hammer a live on-prem server the
sales team is using. The pull is therefore a **resumable, throttled, two-phase
state machine per entity**, not a single job.

### 6.1 Two phases per entity

Each entity (`company`, then `person`, then `opportunity`) moves through:

1. **Backfill** — page through ALL rows once, ascending by id:
   `<idcol> > :lastId ORDER-by-id`, 100 at a time (Sage returns id-ordered).
   After each page, persist the last id and upsert that page immediately. When a
   page returns < 100 rows, the entity's backfill is complete.
2. **Incremental** — thereafter, only changed rows:
   `<updatedcol> >= :highWater AND <idcol> > :lastId`, paged the same way.
   After a full pass, advance `highWater` to the max `updateddate` seen.

Use `>=` (not `>`) on the high-water and rely on idempotent upserts (unique
`sageCrm*Id`) to absorb the overlap — an overlap re-writes a row harmlessly; a
gap loses an update forever. Prefer overlap.

### 6.2 State model (extends `SageSyncState`)

The current `SageSyncState` has a single `cursor`, which is not enough — backfill
position and the incremental high-water are different things. Add (additive
migration, before 7.4b):

- `phase String @default("backfill")` — `"backfill" | "incremental"`.
- `backfillId String?` — last id fetched during backfill (paging position).
- `highWaterUpdatedAt DateTime?` — the incremental cursor (was `cursor`).
- optional `backfillDoneAt DateTime?` and a rough `processed Int?` for progress UI.

### 6.3 Resumability and per-tick budget

Never hold the whole table in memory and never depend on one long request:

- The cron tick has a wall-clock budget (mirror the 60s Google/Microsoft tick).
  Process pages until the budget or a `MAX_PAGES_PER_TICK` cap is hit, then stop —
  progress is already persisted per page, so the next tick resumes exactly where
  it left off. A redeploy or crash mid-backfill costs at most one page.
- Backfill spans many ticks (hundreds of pages). That is fine and expected.

### 6.4 Parent-before-child ordering

People and opportunities carry `companyid` / `primarycompanyid`. Back-fill
**companies to completion first, then people, then opportunities**, so a local
company always exists to link to. If a child still can't resolve its parent
(dirty data), import it with a null link and let the next company pass or a
reconcile fix it — never drop the record. The same order applies within each
incremental tick.

### 6.5 The nested-company payload fork (decide during 7.4a)

A `company` query returns each company with its people/phones/emails/addresses
NESTED (the 8 Mobile Mark companies were 368 KB). At 100 companies/page that
page could be multiple MB and slow. Two options — measure a real 100-row page in
7.4a before committing:

- **(A) Flat per-entity paging** (current client): query company, person,
  opportunity separately. Simpler parser (already built), but company pages are
  still heavy because Sage forces the nesting, and people are fetched twice
  (nested in company AND in the person pass).
- **(B) Hierarchical company pull**: parse the nested children out of the company
  pages to get companies + people + phones + emails in one pass (far fewer round
  trips, guaranteed parent/child cohesion), then a thinner opportunity pass.
  Needs a hierarchical parser (today `parseRecords` deliberately drops children).

Also check in 7.4a whether Sage can return companies WITHOUT children (a leaner
query/field selection) — if so, (A) gets cheap and wins.

### 6.6 Throttling — this is a live production server

- Run backfill **off-peak** (a nightly window) and/or behind a small
  inter-request delay + `MAX_PAGES_PER_TICK`, so the sales team never sees Sage
  slow down. Make the window/caps config constants, not hardcoded.
- Incremental is light (only changed rows) and runs **once nightly** after
  backfill completes.
- One `/internal/sync/sage` route; the tick decides per entity whether it is in
  backfill or incremental phase. Kick off / monitor via `sage.router.ts`
  `status` (expose phase + backfillId + counts) and a manual `syncNow`.

### 6.7 Deletions and drift

A `updateddate >=` incremental never sees hard deletes or merges (Sage CRM
often soft-deletes via a `deleted`/`secterr` flag). Probe for a `deleted`
column in 7.4a; if present, map it to a local archived/inactive state instead of
deleting. Regardless, schedule an occasional **full reconcile** (e.g. monthly:
re-run backfill paging, compare id sets, flag locals whose Sage id has vanished)
to catch drift the incremental cursor can't.

### 6.8 Idempotency (the property everything above leans on)

Every write is keyed by the unique `sageCrm*Id` (and snapshots by
`(entity, sageId)`), matched to an existing local row by natural key
(`domain`/`email`) only when there is no sageId match. So re-running any page,
overlapping the high-water, or resuming after a crash all converge to the same
state — which is what makes the throttled, many-tick, resumable design safe.
