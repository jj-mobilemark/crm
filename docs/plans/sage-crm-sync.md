# Sage CRM sync — Phase 7 (canonical plan)

This is the canonical Phase 7 doc referenced by the stub in
[docs/plans/m365-expansion.md](m365-expansion.md). First cut is **pull only**
for the **Company / Person / Opportunity** triad. Push (local -> Sage) is a
later phase; this cut builds the groundwork (external-id columns, raw
snapshots, and the field-mapping catalog below) so push is mechanical later.

Scope is intentionally small first: a **bounded test slice** (the Mobile Mark
records) so we can plan around real data before the full pull.

## Guiding principle — fit Sage INTO the CRM, don't reshape the CRM

We are NOT mirroring Sage's schema. Sage bends to fit the CRM's out-of-the-box
`Company` / `Contact` / `Deal` as far as it reasonably can. Concretely:

- **Add the fewest columns possible.** A Sage field earns a real local column
  only when the UI needs to show/sort it OR a 1:1 push depends on it. Everything
  else stays in `SageRecordSnapshot` (lossless), which is the fidelity backstop
  for push — nothing is lost even when it is not a column.
- **The mapping catalog (section 3) IS the 1:1 contract.** Those mapped fields
  are the ones a local edit can push back to Sage cleanly. Keep that list tight
  and exact rather than exhaustive.
- **Prefer the existing shape over a truer-to-Sage one** whenever the difference
  is cosmetic. The one real functional exception is forecasting (section 3b) — a
  capability the CRM lacks entirely — and even there the additions are a few
  optional columns, not a new model.
- **No `organizationId`, no parallel Sage tables for core records.** The columns
  added so far (`sageCrm*Id`, `sage100*`) are references, not a reshape.

This reverses the earlier "adopt Sage's stage enum" decision (see 3.3): keep the
CRM's stages, store the raw Sage stage for push.

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
- **~100 rows per page; paginate with `query` -> `next`.** A `query` returns
  ~100 rows and a `<more>` flag; call the `next` operation (empty body, same
  session) repeatedly while `<more>true</more>`. This is Sage's real pagination
  — NOT a `maxrecords` cap. (Confirmed by the sibling project, section 1c.) An
  id-paged alternative (`<idcol> > lastSeenId`) exists and is what makes a
  serverless, resume-across-ticks cron possible — see section 6.3.

### 1c. Sessions, pagination and safety — CONFIRMED in production by the sibling project

A sister app has run this exact sync against the same server for ~14k companies.
Its hard-won facts (treat as authoritative):

- **One Web Services session at a time, globally.** A second `logon` KICKS the
  first off. Every caller must serialize: `logon` -> work -> `logoff` (try/finally).
  Our nightly cron, any manual `syncNow`, and the (deferred) push must hold a
  single global lock so they never overlap.
- **Bad credentials can LOCK the service account.** Never retry-spam `logon`;
  back off hard on an auth failure. (Our client already returns `auth-failed`
  without retrying — keep it that way.)
- **Pagination is `query` then `next` (empty) while `<more>true</more>`**, ~100
  rows/page. This is session-stateful: you cannot resume a `next` chain in a
  later process. Two consequences in section 6.3.
- **The API is SLOW: ~10-20s per page; a full company sync is ~1 hour.** This is
  a long-running job, not a web request.
- **`comp_deleted` exists.** Backfill filters `comp_deleted IS NULL` (see 6.1);
  opportunities have `oppo_deleted`. This resolves how we see deletions.
- **`getmetadata` (entityname=company|person|opportunity)** returns this
  instance's field metadata — use it to confirm field names/extra fields.
- **Volumes (prod, 2026-08-02): ~14,227 companies / ~26,120 contacts** — our
  earlier "27k companies / 14k contacts" was inverted. Only ~4,750 companies
  carry a MAS customer number (the ERP-linked subset); the rest are CRM-only.

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

### Decision that follows from the probe (UPDATED by the sibling project)

**Backfill: query `company` and take the people from its NESTED children — do
NOT query `person` separately.** The sibling project proved this at 14k
companies: contacts arrive nested under each company, so one paged `company`
walk yields companies + people + address + email + phone together, cohesive and
in far fewer round trips. This flips the earlier "flat and separately" note.
Opportunities are NOT nested — pull them with their own `opportunity` query.

Consequence for our built client: `parseRecords` deliberately drops nested
children, so it is fine for `opportunity` and for single-record/incremental
reads, but the backfill needs a **hierarchical parser** (extract nested
`person`/`address`/`email`/`phone` out of each company) plus the **`next`**
pagination operation. Both are foundation gaps to add in 7.4a/7.4b (section 6).

Store the raw record per entity in `SageRecordSnapshot` regardless, so no field
is lost before it is mapped.

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
| `sage100ArDivisionNo` | `mas_ardivisionno` | Sage 100 AR division (always `00` here). Kept as the join key to `MasHeader` / `MasOrderDetailHistory` for the later order-history phase. **CORRECTED 2026-08-02:** NOT shown in the UI — the team does not use the division, so the Sage 100 id displays as the customer number alone (`0011246`, not `00-0011246`). See `formatSage100Id`. |
| `name` | `name` | |
| `ownerId` | `acctmgr` | **ADDED 2026-08-02.** Company owner is a free-text account-manager NAME (not a user id). Resolved to a local user by unique last name + first initial (`matchSageUserByName`). Unmatched names (former reps, blanks, junk) leave the company owner-less. Only 3 current reps appear as `acctmgr`. |
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
| `ownerId` | — (inherited) | **ADDED 2026-08-02.** Contacts inherit their parent company's owner (Sage persons carry no usable owner field). Only set, never cleared. |
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
| `amount` | `forecast` (else `total`) | **CORRECTED 2026-08-02** — see the box below. Sage `total` is empty/0 on every opportunity; the deal value lives in `forecast`. So `amount` (unweighted deal value) ← `forecast`, falling back to `total`. |
| `weightedAmount` | computed | **CORRECTED** — `amount` × `certainty`/100. Sage has no separate weighted field for this team; it is derived. Null when there is no certainty. |
| `probability` | `certainty` | integer 0–100. |
| `currency` | `currency` | default `USD` if blank |
| `stage` | `stage` + `status` | map to `DealStage` (see below) |
| `expectedCloseDate` | `targetclose` | |
| `closedAt` | `closed` → `targetclose` → `opened` | **CORRECTED** — real `closed` date; for a closed-stage deal with no close date, fall back to `targetclose` then `opened`. Never "now" (that bunched every dateless deal into the import month). Open deals: null. |
| `createdAt` | `opened` (else `createddate`) | **CORRECTED** — the deal's real creation date, so the pipeline trend is by when deals actually opened, not by import time. |
| `ownerId` | `assigneduserid` | REQUIRED locally. Resolve via `SAGE_USER_EMAILS`; unmapped → `ken@mobilemark.com`, else earliest User. Never null. |

> **CORRECTED 2026-08-02 — forecast/total semantics (supersedes the earlier
> `amount ← total`, `forecast → weighted` decision).** The original assumption
> was that Sage `total` = unweighted deal value and `forecast` = weighted. The
> live data is the opposite: `total` is empty/`0` on all 525 opportunities and
> the team enters the deal value in `forecast` (with a separate `certainty`).
> Example: opp 380 has `forecast` = 2,029,650, `certainty` = 50, `total` empty —
> a real ~$2M deal. So `amount ← forecast` and `weightedAmount = amount ×
> certainty` (≈ $1.01M). Existing rows were recomputed by
> `apps/api/scripts/sage-backfill-deal-amounts.ts`.

**Stage mapping (`DealStage`).** Sage stage/status vocabulary enumerated from a
100-opportunity sample:

- stage: `Investigation/Prospecting`, `Proposal`, `Negotiation`, `Purchasing`,
  `Closed Won`, `Lost`, (blank)
- status: `In Progress`, `Won`, `Lost`, `Closed`

The local `DealStage` enum is a HubSpot-style pipeline
(`DEMO_BOOKED`, `QUALIFIED_TO_BUY`, `UNQUALIFIED_TO_BUY`,
`DECISION_MAKER_BOUGHT_IN`, `CONTRACT_SENT`, `CLOSED_WON`, `CLOSED_LOST`) that
does NOT match Sage's process.

**DECIDED (2026-08-02, REVISED per the guiding principle): keep the CRM's
`DealStage` enum; map Sage -> local for display; store the raw Sage stage for a
1:1 push.** This reverses the earlier "adopt Sage's stages / replace the enum"
call — replacing the enum re-keys the deal board and every branch on the old
values, which is exactly the over-customization we are avoiding.

Active Sage values (two 100-row samples): stage `Investigation/Prospecting`,
`Proposal`, `Negotiation`, `Purchasing`, `Closed Won`, `Lost`; status
`In Progress`, `Won`, `Lost`, `Closed`. Map into the existing enum:

- `Closed Won` / status `Won` -> `CLOSED_WON`
- `Lost` / status `Lost`,`Closed` -> `CLOSED_LOST`
- `Investigation/Prospecting` -> `QUALIFIED_TO_BUY`
- `Proposal` -> `CONTRACT_SENT`
- `Negotiation` -> `DECISION_MAKER_BOUGHT_IN`
- `Purchasing` -> `CONTRACT_SENT`
- unknown / blank -> `QUALIFIED_TO_BUY` (never fail the import)

**For push fidelity**, keep the exact Sage stage/status so a local change maps
back 1:1. The raw values already live in `SageRecordSnapshot`; add a small
`Deal.sageStage String?` only if the board/UI needs to display the true Sage
stage without a snapshot read. No enum change, no board re-key.

---

## 3b. Forecasting — what it is in Sage, and the gap here

The team forecasts in Sage. Forecasting there is NOT a separate record type we
can sync: the dedicated `forecast` entity is **not Web Service enabled**. Sage
sales forecasting is driven by the **opportunity** itself. The relevant fields
(all confirmed present and populated):

- `forecast` — **the deal value the team enters** (unweighted). CORRECTED
  2026-08-02: earlier notes called this "weighted" — it is not (see §3.3 box).
- `total` — nominally the unweighted total, but **empty/`0` on every
  opportunity here** (the team does not use it). We fall back to it only if
  `forecast` is ever blank.
- `certainty` — probability %, real values seen: `0,10,25,50,75,90,100`.
- `stage` / `status` — pipeline position.
- `targetclose` — the period the revenue lands in (the axis a forecast is built on).
- `opened` — when the opportunity was created (→ `Deal.createdAt`).
- `type` — `Key Opportunity` / `New Business` / `Baseline Business`.

A Sage forecast is essentially: **sum of `forecast` × `certainty` (the weighted
value) for open opportunities, grouped by `targetclose` period and rep**. We
store `amount` = `forecast` and `weightedAmount` = `amount` × `certainty`, so
the local forecast view reconstructs this exactly.

**DECIDED (2026-08-02): forecasting is IN the first cut** — add the fields in
7.1, map them, and build a forecast view. This is the deliberate exception to
the "add the fewest columns" principle: three optional `Deal` columns for a
capability the CRM lacks entirely, not a new model. Everything else Sage carries
on an opportunity stays in the snapshot.

**Status 2026-08-02:** Forecast view UI landed and **7.4b full pull is DONE**
(section 6) — ~14.2k companies / ~24.8k contacts / 525 deals imported, owners
mapped, dates and forecast/amount corrected. Incremental is wired.

For **bidirectional** later: reps forecasting in THIS app means writing
`stage`, `certainty`, `forecast`, `targetclose` back onto the Sage opportunity
via SOAP `update`. That is exactly how Sage's own forecast recomputes, so no
`forecast`-entity access is needed.

## 3c. Feature-completeness check (are we missing crucial things?)

Beyond the triad, these Sage capabilities exist and matter for an interface
layer. Decide which are in scope:

| Sage capability | WS status | Local equivalent | Recommendation |
| --- | --- | --- | --- |
| **Forecasting** (opportunity-driven) | via `opportunity` | Deal cols + overview forecast | **Done for pull** — extend further on push. |
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

1. **Owner mapping — DECIDED: static map** in `sage.mappings.ts`
   (`SAGE_USER_EMAILS` / `SAGE_USERS`). List supplied 2026-08-02; the 11 users
   are pre-created by `ensureSageUsers`. Deal owner ← `assigneduserid`; unmapped
   → `ken@mobilemark.com` (Sage 27), else earliest User. **Company owner ←
   `acctmgr` name** (`matchSageUserByName`); **contacts inherit** the company
   owner (§3.1/§3.2).
2. **Deal amount source — CORRECTED 2026-08-02:** `Deal.amount` ← opportunity
   `forecast` (the deal value; `total` is unused/empty here), and
   `weightedAmount` = `amount` × `certainty`. This supersedes the original
   `amount ← total`, `forecast → weighted` decision (see the §3.3 box).
3. **Stage model — DECIDED (revised): keep the CRM's `DealStage` enum**, map
   Sage -> local for display, store the raw Sage stage for 1:1 push (section
   3.3). No enum swap / board re-key (per the guiding principle).
4. **Forecasting — DECIDED: in the first cut** (section 3b). Deal columns +
   opportunity import + forecast view UI + **7.4b full pull are all DONE**
   (2026-08-02). Amount/weighted semantics corrected (§3.3 box).
5. **Which extra modules** to bring in (order of value): communications ->
   order history -> leads -> quotes/cases. Confirm with the team. (Not blocking
   the triad.)
6. **Domain collisions**: several Mobile Mark companies share the same name and
   likely the same web domain (`Company.domain` is `@unique`). Matching by
   domain will collapse them; match by `sageCrmCompanyId` FIRST, fall back to
   domain only when no sageId match, and allow `domain` to be null to avoid
   unique-constraint clashes across the 8 near-duplicates. (Handled in
   `SagePullService`.)
7. **Network reachability** of `crm.mobilemark.com` from the deploy environment
   (worked from this machine; confirm from Vercel/Railway; watch for IP
   allowlists).
8. **Later: Sage 100 order history.** `MasHeader` (open-order headers) and
   `MasOrderDetailHistory` (invoice/shipment lines) join to a company via
   `mas_ardivisionno` + `mas_customerno` (kept in the company snapshot). A
   read-only order-history view is a natural follow-on phase.

---

## 5. Build phases

**Status (2026-08-02):** 7.1, 7.2 SOAP client, 7.3 mappings, **7.4a test-slice**,
**7.4c Sage-ID UI**, **forecast view UI**, AND **7.4b full pull** are all DONE.
The first full backfill ran locally off-peak: ~14.2k companies / ~24.8k
contacts / 525 deals / 39.5k snapshots, `phase = incremental`. Company/contact
owners mapped from `acctmgr`; deal dates from `opened`/`closed`; amount/weighted
corrected (§3.3 box). Remaining Sage work (reconcile soft-deactivate §6.7 and
push, Part G) is DESIGN-ONLY.

1. **7.1 Schema** (DONE): `RecordSource.SAGE`; ids —
   `Company.sageCrmCompanyId`, `Contact.sageCrmContactId`,
   `Deal.sageCrmOpportunityId` (all `String? @unique`), plus
   `Company.sage100CustomerNo` + `Company.sage100ArDivisionNo` (section 3d);
   KEEP the existing `DealStage` enum (map Sage -> local, section 3.3);
   `Deal.sageStage` / `Deal.sageStatus`; forecasting fields
   (`probability`, `weightedAmount`, `dealType`); `SageSyncState`;
   `SageRecordSnapshot`. Migrations `add_sage_sync` +
   `add_deal_sage_fields`.
2. **7.2 Config + client** (DONE): `SAGE_SOAP_*`; logon/query/next/logoff;
   `queryAllCompanies` / `queryAllRecords`.
3. **7.3 Mapping catalog** (DONE): `sage.mappings.ts` from section 3
   (company, contact, opportunity + stage mapper + owner emails).
4. **7.4a Test-slice import** (DONE): Mobile Mark companies (hierarchical) +
   nested people + opportunities (`oppo_primarycompanyid IN (…) AND
   oppo_deleted IS NULL`); snapshots; upserts; `DealContact` from
   `primarypersonid`.
5. **7.4c Sage-ID UI** (DONE for company/contact/**deal**): `CopyButton`; id
   fields on list/byId; table columns + sheet sections.
6. **7.4b Full pull at scale** (DONE 2026-08-02 — local one-shot):
   `SagePullService.runBackfill()` + `apps/api/scripts/sage-backfill.ts`.
   Two-phase (backfill → incremental), single global session via
   `withSageSession` (Postgres advisory lock), throttled `query`/`next` company
   walk (`comp_deleted IS NULL`, nested people) then a full opportunity walk
   (`oppo_deleted IS NULL`). `SageSyncState` extended
   (`phase`/`backfillId`/`highWaterUpdatedAt`/`processed`/`backfillDoneAt`,
   migration `add_sage_backfill_state`); soft-deactivate + push-echo columns
   added (design-only). `GET /internal/sync/sage` now runs `runScheduled()`
   (test slice while `phase=backfill`, incremental once flipped) — no router
   change, `server.ts` untouched. **Deviations from the original design**:
   local script instead of a Railway worker; `query`/`next` full walk instead of
   id-paged resume (Sage is not id-ordered — proven; a re-run is the safe
   recovery). One-time cleanups: `sage-backfill-owners.ts`,
   `sage-backfill-deal-dates.ts`, `sage-backfill-deal-amounts.ts`.
7. **Deferred (push + reconcile)**: `SageOutbox` + `sage-push.service.ts` +
   create hooks; monthly reconcile that soft-deactivates ids absent from a full
   run (§6.7). DESIGN-ONLY — do not build unless asked. `sage.router.ts`
   status/syncNow also not yet built (cron uses the CRON_SECRET route).

---

## 6. Scale: backfill + progressive incremental sync

Production Sage holds roughly **~14k companies and ~26k contacts** (sibling
project, confirmed in prod — our earlier figure was inverted; ~4.75k companies
carry a MAS customer number). That still rules out "one query = everything":
pages are ~100 rows, the API is slow (~10-20s/page, ~1h for a full company
sync), only ONE session may be open at a time, and it is a live on-prem server
the sales team uses. So: a **two-phase (backfill -> incremental), throttled,
single-session** pull.

### 6.0 Gate — open questions (ANSWERED 2026-08-02, 7.4b shipped)

All eight were resolved before building; kept here for the record. Full answers
also in `HANDOFF.md` "Open questions … ANSWERED".

1. **Backfill runtime** — LOCAL one-shot script, `query`/`next`, off-peak.
2. **Where** — local, from the maintainer's machine (dry-run → full run).
3. **Soft-deactivate** — `sageDeactivatedAt` on Company/Contact/Deal
   (reconcile that sets it is design-only).
4. **Opportunity walk** — ALL non-deleted opps after companies complete.
5. **Global lock** — Postgres advisory lock (`withSageSession`).
6. **Route** — kept `/internal/sync/sage`; `runScheduled` auto-switches
   test-slice → incremental once `phase` flips.
7. **Throttle** — `SAGE_PAGE_DELAY_MS` + `SAGE_MAX_BACKFILL_PAGES`, off-peak.
8. **Commit forecast UI** — still uncommitted; commit with 7.4b.

**Deviations from this plan**: local script (not a Railway worker); `query`/`next`
full walk (not id-paged resume — Sage is not id-ordered).

**Already reusable from 7.4a** (do not rebuild): hierarchical parse +
`enrichPerson`; `queryAllCompanies` / `queryAllRecords` + `next`; opportunity
mapping + `importTestSlice` as the bounded reference implementation.
`SageSyncState` still has only `status` + `cursor` — phase fields are additive
(6.2). No inactive flag on core models yet (6.7).

### 6.1 Two phases (query the COMPANY, take contacts from its nested children)

Backfill and incremental both walk the `company` entity and read people/address/
email/phone from each company's nested children (see the updated decision in
section 1). Opportunities are a separate `opportunity` walk (not nested).

1. **Backfill** — every non-deleted company, once:
   - Filter: `comp_deleted IS NULL` (NOT a status filter — the sibling project
     learned status filters silently miss Prospect/NULL/DONTSEND rows; treat
     `status` as informational).
   - Paginate with `query` then `next` while `<more>true</more>`, ~100/page.
   - Per company: upsert by `sageCrmCompanyId`; upsert each nested person by
     `sageCrmContactId` (else match local by email+company); set primary contact
     when `primarypersonid` matches.
2. **Incremental** — nightly, only changed:
   `comp_updateddate > '<lastSync minus ~1h overlap>' AND comp_deleted IS NULL`,
   same `query`/`next` paging.

Idempotent upserts (unique `sageCrm*Id`) absorb the ~1h overlap and Sage's
duplicate rows across pages — overlap re-writes harmlessly; a gap loses an
update forever, so prefer overlap. "Created/updated" counts look inflated
because of cross-page duplicates; the unique row count is the real measure.

### 6.2 State model (extends `SageSyncState`)

The current `SageSyncState` has a single `cursor`, which is not enough — backfill
position and the incremental high-water are different things. Add (additive
migration, before 7.4b):

- `phase String @default("backfill")` — `"backfill" | "incremental"`.
- `backfillId String?` — last id fetched during backfill (paging position).
- `highWaterUpdatedAt DateTime?` — the incremental cursor (was `cursor`).
- optional `backfillDoneAt DateTime?` and a rough `processed Int?` for progress UI.

### 6.3 Single session -> a worker for backfill, cron for incremental

The single-session rule plus `next`-based (session-stateful) pagination shapes
the runtime. `next` cannot resume in a later process, so there are two shapes:

- **Initial backfill = one long-running job** (the sibling project's approach):
  a dedicated **Railway worker** holds ONE session, pages `query`/`next` to
  `more=false` (~1h), then `logoff`. Run it **off-peak**, once, on demand. This
  matches Sage's design and avoids a session being repeatedly kicked.
- **Incremental = nightly cron** (`/internal/sync/sage`, `CRON_SECRET`): the
  changed set is small, so one session per night finishes inside a normal run.
- **Resume-across-ticks (only if we ever chunk the backfill into a serverless
  cron instead of a worker):** don't use `next`; page by `comp_companyid >
  :lastId` with a fresh `logon` per tick, persisting `backfillId` each page. It
  costs more logons but survives redeploys. Decide worker-vs-chunked at build.

**A global lock is mandatory** regardless: nightly cron, manual `syncNow`, the
backfill worker, and the deferred push must never hold two sessions at once (a
second `logon` kicks the first). Use a `SageSyncState` `RUNNING` guard or a
Postgres advisory lock; on an auth failure, back off hard (a bad password can
LOCK the service account — never retry-spam `logon`).

### 6.4 Parent-before-child ordering

People and opportunities carry `companyid` / `primarycompanyid`. Back-fill
**companies to completion first, then people, then opportunities**, so a local
company always exists to link to. If a child still can't resolve its parent
(dirty data), import it with a null link and let the next company pass or a
reconcile fix it — never drop the record. The same order applies within each
incremental tick.

### 6.5 Hierarchical company pull — DECIDED (option B)

The sibling project settled this at 14k companies: **query `company` and read
the nested people/address/email/phone; do NOT query `person` separately.** Fewer
round trips and guaranteed parent/child cohesion. Our built `parseRecords` drops
nested children, so the backfill needs a hierarchical parser added (extract the
`person`/`address`/`email`/`phone` child records under each company). Payloads
are large (100 companies with children = several MB) but that is the accepted
cost; the API's ~10-20s/page dominates anyway.

### 6.5b Dirty data — sanitize before saving

Real Sage data is messy (the sibling project hit all of these): angle brackets
in names/emails, emails stuffed into name fields, empty names, phones split as
`areacode` + `number`. Sanitize in the mapping: strip `<>` from emails, treat an
empty `firstname`/`name` (fallback `companyname`) as null, and keep MAS customer
numbers as strings so leading zeros survive (our mappings already lowercase
email, join phone, and keep ids as strings — extend with `<>` stripping).

### 6.6 Throttling — this is a live production server

- Run backfill **off-peak** (a nightly window) and/or behind a small
  inter-request delay + `MAX_PAGES_PER_TICK`, so the sales team never sees Sage
  slow down. Make the window/caps config constants, not hardcoded.
- Incremental is light (only changed rows) and runs **once nightly** after
  backfill completes.
- One `/internal/sync/sage` route; the tick decides per entity whether it is in
  backfill or incremental phase. Kick off / monitor via `sage.router.ts`
  `status` (expose phase + backfillId + counts) and a manual `syncNow`.

### 6.7 Deletions and drift (`comp_deleted` confirmed)

`comp_deleted` / `oppo_deleted` exist, so backfill/incremental already exclude
deletions via `... AND comp_deleted IS NULL`. But an incremental pass never sees
a row that got deleted or merged since last run. The sibling project's answer,
adopted here: on a FULL reconcile, local Sage ids not seen in the run get
**verified with a single-company query and soft-deactivated — never
hard-deleted**. The flag now exists (`sageDeactivatedAt` on Company/Contact/Deal,
added in 7.4b). The reconcile job that SETS it is not built yet — DESIGN-ONLY,
schedule occasionally (e.g. monthly), not nightly.

### 6.8 Idempotency (the property everything above leans on)

Every write is keyed by the unique `sageCrm*Id` (and snapshots by
`(entity, sageId)`), matched to an existing local row by natural key
(`domain`/`email`) only when there is no sageId match. So re-running any page,
overlapping the high-water, or resuming after a crash all converge to the same
state — which is what makes the throttled, many-tick, resumable design safe.
