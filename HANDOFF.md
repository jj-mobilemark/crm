# HANDOFF.md — agent handoff log

This file is the single source of truth for "where is this project and what
happens next". Every agent MUST read it before starting work and MUST update
it before stopping. The rules for maintaining it live in `AGENTS.md`
("Handoff protocol").

## How to update this file

- **Append, never rewrite history.** Add a new dated entry at the top of the
  "Work log" section. Keep old entries untouched.
- Each entry must answer four questions:
  1. **What was completed** — concrete outcomes, with file paths.
  2. **How and why** — the approach taken and the reason for it.
  3. **Deviations** — anything that differs from the plan or from upstream,
     and why. If nothing deviated, say "None".
  4. **What's next** — the exact next step a new agent should take, with a
     pointer to the relevant plan section.
- Also keep the "Current state" section below up to date (edit in place —
  this section IS a rewrite-in-place summary, unlike the log).

---

## Current state (keep this section up to date)

- **Git**: `origin` = `jj-mobilemark/crm` (fork); `upstream` = `trycompai/crm`
  (read-only). Work on `main`. Pre-upstream-merge snapshot: `421e556`.
  **7.4a + 7.4c code is UNCOMMITTED** (see `git status`: sage pull/controller,
  copy-button, table/sheet UI, HANDOFF, plan). Commit before the next phase
  unless the human says otherwise.
- **Upstream delta absorbed**: ~40 `packages/ui` restyles + favicon + prefetch.
  **Visual pass still needed** on Microsoft settings + sign-in.
- **Verification**: `check-types` api/app/ui green; Sage unit tests 24 pass;
  live Mobile Mark smoke OK. After person-email fix: **94 emails / 26 blank**.
- **Runs locally**: Postgres via `docker compose up -d`. Prefer
  `bun run src/main.ts` in `apps/api` (**restart after Sage edits** — no hot
  reload) + `bun run dev` in `apps/app`. Re-run test slice:
  `curl -X POST -H "Authorization: Bearer $(grep '^CRON_SECRET=' .env | cut -d= -f2- | tr -d \"\\'\")" http://localhost:3001/internal/sync/sage`.
- **Auth / env**: allow-list `ALLOWED_SIGN_IN=mobilemark.com`; Microsoft SSO
  works. `MICROSOFT_*` + `CRON_SECRET` + `SAGE_SOAP_*` in root `.env` (never
  record secrets here).
- **Sage test slice in DB**: 8 companies (Sage CRM ids 24, 4139, 4143, 4145,
  4146, 4153, 4214, 9677) + 120 contacts. Company **24** = MOBILE MARK INC,
  Sage 100 `00-0000777`, **4 opportunities in Sage (not imported yet)**.
  Dirty first names (`*`); near-dupes leave `domain` null except one
  `mobilemark.com` claim.
- **Active plan**: `docs/plans/sage-crm-sync.md` (canonical). Stub:
  `docs/plans/m365-expansion.md` Phase 7.
- **Phases 0–5**: DONE. **Phase 6**: DEFERRED by human.
- **Phase 7 DONE**: 7.1 company/contact schema + snapshots; 7.2 SOAP client;
  7.3 mappings + `SAGE_USER_EMAILS`; 7.4a test-slice import; 7.4c Sage-ID UI.
- **Phase 7 key files**:
  - `apps/api/src/sage/sage-soap.client.ts` — logon/query/next/logoff
  - `apps/api/src/sage/sage-xml.ts` — flat + hierarchical (`enrichPerson`)
  - `apps/api/src/sage/sage.mappings.ts` — maps + owner emails
  - `apps/api/src/sage/sage-pull.service.ts` — `importTestSlice()`
  - `apps/api/src/sage/sage-sync.controller.ts` — `/internal/sync/sage`
  - `packages/ui/src/components/copy-button.tsx`
  - `apps/app/components/crm/sage-id.ts` + `sage-id-value.tsx`
- **Phase 7 NOT done**: `Deal` still has **no** `sageCrmOpportunityId` /
  forecasting columns (schema.prisma `Deal` is stock). No `mapOpportunity`.
  No opportunity pull. No forecast view UI. No 7.4b full pull.
- **Guiding principle**: fit Sage INTO existing models; fewest columns;
  snapshot = lossless backstop; **KEEP** `DealStage` enum (map per §3.3).
- **Decisions already made**: owner map static (in `sage.mappings.ts`);
  `amount` ← `total`, weighted ← `forecast`; forecasting IN as optional Deal
  columns; stages map §3.3.
- **Gotchas**: `query`→`next` while `<more>`; ONE session globally; never
  retry-spam logon; person emails nested under person (do not steal into
  company).
- **Next step (ONE path — do this, no fork)**: Deal schema + opportunity
  import for the test slice. Plan: `docs/plans/sage-crm-sync.md` §§3.3, 3b.
  1. Additive Prisma migration on `Deal`: `sageCrmOpportunityId String?
     @unique`, `probability Int?`, `weightedAmount Decimal?`, `dealType
     String?`, optional `sageStage`/`sageStatus` String? for push.
  2. Add `mapOpportunity` + stage mapper in `sage.mappings.ts` (§3.3 table).
  3. Extend `importTestSlice` to query `opportunity` with
     `oppo_primarycompanyid` in slice ids (or `= 24` first) AND
     `oppo_deleted IS NULL`; upsert Deal + `SageRecordSnapshot`.
  4. **Fallback owner** when `assigneduserid` unmapped: User with email
     `ken@mobilemark.com` (Sage id 27); else earliest User by `createdAt`.
     Never null `ownerId`.
  5. Smoke: re-run `/internal/sync/sage`; expect ~4 deals on company 24.
  Later: forecast view UI; then 7.4b (plan §6).
- **Scale note (7.4b later)**: ~14k companies / ~26k contacts;
  `comp_deleted IS NULL`; need `SageSyncState` phase fields + global lock +
  soft-deactivate.

## Work log (newest first)

### 2026-08-02 — Handoff tightened for next agent (agent: Grok via Cursor)

**Plan / phase**: docs only — `HANDOFF.md` Current state + plan open items.

**What was completed**

- Replaced ambiguous "deals OR 7.4b" next step with a single 5-step Deal +
  opportunity-import recipe (schema fields, mapOpportunity, pull filter,
  fallback owner `ken@mobilemark.com`, smoke).
- Noted **uncommitted** 7.4a/7.4c file set; listed key Sage files; recorded that
  `Deal` still lacks forecasting columns.
- Cleared stale "BLOCKING: supply owner map" in plan §4 (map is in
  `sage.mappings.ts`); set fallback owner rule.
- Updated `m365-expansion.md` Phase 7 stub status.

**How and why**

- Human asked whether the next agent could continue with no questions. Gaps
  were: forked next step, missing default-owner decision, stale blocking note,
  no mention that work is uncommitted / Deal schema untouched.

**Deviations**

- None.

**What's next**

- Unchanged: Deal schema + opportunity import (Current state recipe).

### 2026-08-02 — Phase 7.4c Sage-ID UI + person-email parse fix (agent: Grok via Cursor)

**Plan / phase**: `docs/plans/sage-crm-sync.md` — 7.4c (+ eyeball of 7.4a data).

**What was completed**

- Eyeballed Mobile Mark import: 8 companies, Sage 100 on 24 (`00-0000777`) and
  4139 (`00-MME`); dirty first names (`*`); **0/120 emails** exposed a parser
  bug (person nested email/phone were dropped / stolen by company walk).
- Fixed hierarchical parse: direct-child collection only + `enrichPerson` for
  nested email/phone (`sage-xml.ts`). Re-import → **94 emails / 26 blank**.
- `CopyButton` in `packages/ui/src/components/copy-button.tsx` (Carbon Copy +
  sonner toast, stops row-click propagation).
- API: Sage id fields on `companies.list` / `companies.byId` and
  `contacts.list` / `contacts.byId` (+ nested company Sage 100 on contacts)
  (`companies.service.ts`, `contacts.service.ts`).
- UI: default-hidden Sage CRM ID + Sage 100 ID columns on
  `companies-table.tsx` / `contacts-table.tsx`; "Sage" section on
  `company-sheet.tsx` / `contact-sheet.tsx` (read-only + copy). Helpers:
  `sage-id.ts`, `sage-id-value.tsx`.

**How and why**

- Handoff next was 7.4c once real ids existed. Eyeball first caught the email
  gap; fixed before shipping UI so sheets show useful contact data too.

**Deviations**

- None vs plan section 3d. Opportunities still deferred with Deal fields.

**What's next**

- **ONE path**: Deal schema + opportunity import (company 24 has 4 opps).
  Exact 5-step recipe in Current state above and plan §§3.3 / 3b. Do not start
  7.4b until deals land. Work is still uncommitted — commit first if asked.

### 2026-08-02 — Phase 7.4a Mobile Mark test-slice import (agent: Grok via Cursor)

**Plan / phase**: `docs/plans/sage-crm-sync.md` — 7.4a.

**What was completed**

- Hierarchical company parse + `<more>` flag in `apps/api/src/sage/sage-xml.ts`
  (`parseCompanyTrees`, `parseCompanyPage`, `parseMore`).
- SOAP client: `queryCompanies` / `nextCompanies` / `queryAllCompanies` + `next`
  op in `apps/api/src/sage/sage-soap.client.ts`.
- Mappings: `mapCompanyTree`, `companyname` fallback, `<>` email sanitize,
  nested parent company id for people (`sage.mappings.ts`).
- `SagePullService.importTestSlice` — upsert Company/Contact by `sageCrm*Id`
  (else domain/email link), write `SageRecordSnapshot`, set primary contact,
  in-process session lock + always `logoff`
  (`apps/api/src/sage/sage-pull.service.ts`).
- `POST/GET /internal/sync/sage` (`CRON_SECRET`) —
  `apps/api/src/sage/sage-sync.controller.ts`; wired in `sage.module.ts`.
- Unit tests: 24 pass (`test/sage-xml.spec.ts`, `test/sage-mappings.spec.ts`).
- Live smoke against prod Sage: 8 companies, 120 contacts, 128 snapshots, 16
  skipped (people missing firstname), ~7s.

**How and why**

- Handoff next step was 7.4a. Sibling knowledge: pull `company` hierarchically,
  paginate with `next`, never hold two sessions. Kept opportunities out — Deal
  forecasting columns are still deferred. Domain uniqueness: near-duplicate
  Mobile Mark rows get `domain: null` when the web domain is already taken.

**Deviations**

- Skipped `getmetadata` (plan mentioned it; not required for the upsert path —
  optional follow-up).
- Skipped opportunity import (depends on deferred Deal fields), as handoff
  already noted.

**What's next**

- **7.4c Sage-ID UI** (plan section 3d): `CopyButton` in `packages/ui`; expose
  ids on company/contact list + byId; default-hidden table columns; "Sage"
  section on company + contact sheets. Real Mobile Mark ids are in the DB now.
- Then Deal forecasting columns + opportunity import; then 7.4b full pull.

### 2026-08-02 — Phase 7 principle: fit Sage into the CRM, don't reshape it (agent: Opus via Cursor)

**Plan / phase**: `docs/plans/sage-crm-sync.md` — new "Guiding principle" +
section 3.3 (no code).

**What was completed**

- Added a guiding principle to the plan: Sage bends to the CRM's out-of-the-box
  shape; add the fewest columns (only for UI need or 1:1 push); the raw snapshot
  is the lossless backstop; the mapping catalog is the 1:1 push contract.
- REVERSED the earlier "adopt Sage's stages / replace `DealStage` enum + re-key
  the board" decision. Now: keep the CRM enum, map Sage->local for display,
  store the raw Sage stage for exact push (optional `Deal.sageStage` only if the
  UI needs it). Updated section 3.3, the 7.1 build bullet, and open item #3.
- Reaffirmed forecasting's 3 `Deal` columns as the one deliberate exception (a
  capability the CRM lacks), not a reshape.

**How and why**

- The human clarified they don't want a big new contacts/companies shape — fit
  Sage into what the CRM gives us, keep only the fields that push back 1:1. The
  external-id + Sage 100 columns already added are references, not a reshape, so
  they stand; the enum swap was the one over-customization to drop.

**Deviations**

- Reverses the 2026-08-02 stage decision (documented above). No other change.

**What's next**

- Unchanged: 7.4a test-slice import (nested `company` pull + `getmetadata`),
  then 7.4b per section 6.

### 2026-08-02 — Phase 7 plan corrected from sibling-project knowledge (agent: Opus via Cursor)

**Plan / phase**: `docs/plans/sage-crm-sync.md` — sections 1c + 6 (no code).

**What was completed**

- Folded a knowledge dump from the team's other Sage-sync app (proven in prod at
  ~14k companies) into the plan. Corrections/confirmations:
  - Volumes INVERTED: ~14k companies / ~26k contacts (not 27k/14k); ~4.75k
    companies have a MAS customer number.
  - Pagination is `query` -> `next` while `<more>true</more>` (~100/page), not a
    `maxrecords` cap. Session-stateful, so it can't resume in a later process.
  - ONE Web Services session at a time (2nd logon kicks 1st) -> global lock
    mandatory. Bad password can LOCK the service account -> back off, no
    retry-spam. API ~10-20s/page, ~1h full sync.
  - Backfill = query `company`, take people from NESTED children (do NOT query
    `person` separately) — resolved the flat-vs-hierarchical fork to
    hierarchical. Filter `comp_deleted IS NULL` (status filters miss rows).
    `comp_deleted`/`oppo_deleted` exist; reconcile = soft-deactivate, never
    hard-delete. `getmetadata` for field discovery.
  - Opportunity create (push, later): unprefixed field names on `add`,
    `description` max 50 chars.
- New runtime shape in section 6.3: initial backfill as a Railway worker holding
  one session (~1h, off-peak); incremental as nightly cron.

**How and why**

- The sibling app already solved this against the same server; adopting its
  hard-won constraints avoids us re-learning the session/pagination/lockout
  traps the expensive way.

**Deviations / impact on the built foundation**

- The client built earlier now has KNOWN GAPS for the full pull: no `next`
  operation, `parseRecords` drops nested children (need a hierarchical parser),
  and no `<>` email sanitize. All fine for the small test slice; must be added
  for 7.4b. Documented in the plan and current-state.

**What's next**

- 7.4a test-slice import using the nested `company` pull + `getmetadata`; then
  7.4b per the revised section 6 (worker backfill + nightly incremental).

### 2026-08-02 — Phase 7 foundation built: schema + SOAP client + mappings (agent: Opus via Cursor)

**Plan / phase**: `docs/plans/sage-crm-sync.md` — 7.1 (schema), 7.2 (config +
client), 7.3 (mappings). Deal work + import + UI deferred.

**What was completed** (all green: check-types 10/10, lint 7/7, test 127 pass)

- Schema (additive) + migration `packages/db/prisma/migrations/20260802190000_add_sage_sync`:
  `RecordSource.SAGE`; `Company.sageCrmCompanyId @unique` +
  `sage100CustomerNo` + `sage100ArDivisionNo`; `Contact.sageCrmContactId @unique`;
  models `SageSyncState` (per-entity cursor) + `SageRecordSnapshot` (raw replica).
  Prisma client regenerated.
- Config: `SAGE_SOAP_URL/USER/PASSWORD` documented in `.env.example` and declared
  `@IsOptional() @IsString()` in `apps/api/src/config/env.validation.ts`.
  `apps/api/src/sage/sage.config.ts` — `sageCredentials()` all-three-or-none
  capability helper (mirrors `googleCredentials()`).
- `apps/api/src/sage/` module:
  - `sage-soap.client.ts` — `SageSoapClient`: logon (session cache + one
    re-logon on stale-session fault), `query(entity, predicate)`, `logoff`; raw
    `fetch` + hand-built envelopes; `SageResult<T>` union (never throws).
  - `sage-xml.ts` — pure parsing via `fast-xml-parser` (added dep):
    `parseSessionId`, `parseFault`, `parseRecords` (returns a record's OWN
    scalar fields; drops nested child collections so a `company` response's
    nested people don't leak).
  - `sage.mappings.ts` — `mapCompany`/`mapContact` (+ `sage100Display`), and the
    static Sage-user->email owner map from the team with `emailForSageUser`
    (unknown ids -> null, i.e. former employees -> fallback owner).
  - `sage.constants.ts`, `sage.module.ts`; `SageModule` registered in
    `app.module.ts`.
- Tests: `apps/api/test/sage-xml.spec.ts` + `test/sage-mappings.spec.ts` (16).

**How and why**

- Picked the durable, non-breaking foundation for one session: schema + client +
  mappings, fully typed/linted/tested. Migration authored by hand + `migrate
  deploy` because `prisma migrate dev` needs a TTY (non-interactive here).
  Used `fast-xml-parser` rather than regex because the `company` response nests
  child records — regex can't reliably scope a record's own fields.

**Deviations**

- Deferred ALL Deal changes (the `DealStage` enum swap re-keys the deal board UI
  and existing deals — too big to bundle safely) and the import route/UI. The
  SOAP client therefore has no runtime caller yet; it is exercised only by tests.
- Owner map: Jordan Johnson intentionally imitates Ken (id 27); unknown/former
  users resolve to null for a fallback owner (per the human's instruction).

**What's next**

- 7.4a: the Mobile Mark test-slice import (companies + people) behind a
  `CRON_SECRET` internal route, then 7.4c (Sage-ID UI), then a dedicated deals
  session (enum swap + forecasting + opportunity import). Full pull (7.4b) must
  paginate — Sage caps queries at ~100 rows.

### 2026-08-02 — Phase 7 feature-gap pass: Sage modules + forecasting (agent: Opus via Cursor)

**Plan / phase**: `docs/plans/sage-crm-sync.md` — feature-completeness review.

**What was completed**

- Probed Sage module availability over SOAP. Enabled: `company`, `person`,
  `opportunity`, `communication` (activities), `lead`. NOT enabled: `forecast`,
  `campaign`. Ambiguous ("Query failed", likely enabled but wrong id column):
  `case`, `quotes`, `orders`, `user`. Two distinct error strings distinguish
  "not Web Service enabled" from "query error" — documented in the plan.
- Enumerated opportunity vocabulary (100-row sample): stages
  Investigation/Prospecting, Proposal, Negotiation, Purchasing, Closed Won,
  Lost; statuses In Progress/Won/Lost/Closed; types Key Opportunity/New
  Business/Baseline Business; certainty 0-100%.
- Answered the forecasting question in the plan (section 3b): Sage forecasting
  is OPPORTUNITY-driven (`forecast`/`total`/`certainty`/`targetclose`/`type`),
  not a separate syncable record. Local `Deal` is missing
  probability/weighted-amount/type + any forecast view — the headline gap for a
  Sage interface layer. Added a feature-completeness table (section 3c) and new
  open items (stage model A/B, forecasting scope, extra modules).
- Updated `HANDOFF.md` and the `project-overview` rule pointer to Phase 7.

**How and why**

- The human flagged that the team forecasts in Sage and worried about missing
  crucial functionality. Probed live to ground the answer instead of guessing.
  Forecasting turns out to be the real risk: without it the app is not yet a
  replacement surface for the team.

**Deviations**

- None. New constraint: `forecast` entity is not Web-Service enabled, so formal
  Sage forecast submissions cannot be synced (reconstruct from opportunities).

**What's next**

- Get decisions in plan section 4 (owner fallback, amount source, stage model,
  forecasting-in-first-cut, extra modules), then start Phase 7.1 schema.

### 2026-08-02 — Phase 7 scoping: Sage CRM SOAP confirmed + mappings (agent: Opus via Cursor)

**Plan / phase**: `docs/plans/sage-crm-sync.md` — Phase 7.0 (de-risk / scope).

**What was completed**

- Probed the live Sage CRM SOAP endpoint (`.../eware.dll/WebServices/SOAP`)
  with the service account in root `.env`. Confirmed logon -> `sessionid`
  (SOAP header `sessionheader`), `query { queryString, Entity }`, and `logoff`.
  Namespaces: request `http://tempuri.org/`, response `http://tempuri.org/type`.
- Confirmed the triad is queryable: `company`, `person`, `opportunity` all
  return records. `user` entity is NOT exposed (query fails) — blocks direct
  owner mapping. GET/WSDL return empty; only SOAP POST works.
- Captured full field lists for company/person/opportunity (+ nested
  email/phone/address) and wrote the field-mapping catalog into
  `docs/plans/sage-crm-sync.md` (section 3). Predicates use DB names
  (`comp_`/`pers_`/`oppo_`); responses use short names; cursor = `updateddate`.
- Test slice sized: `comp_name like 'Mobile Mark%'` = 8 companies (<=10 cap).
  Company `24` (MOBILE MARK INC) has 4 opportunities incl. real data
  ("249 PR-LTMWG944-SP716" Closed Won, "Jordan Test Push From Sales Tool").
- Company carries `mas_ardivisionno` + `mas_customerno` — the Sage 100 key that
  joins to `MasHeader`/`MasOrderDetailHistory` for a future order-history phase.
- Repointed the Phase 7 stub in `docs/plans/m365-expansion.md` at the new doc.

**How and why**

- Scope-before-build per the user's request. Probing live proved the triad is
  reachable (only `Mas*` was proven before) and gave real field names so the
  mapping catalog is grounded, not guessed. Pull each entity flat (person via
  `pers_companyid`, opportunity via `oppo_primarycompanyid`) instead of walking
  the deep nested `company` doc — simpler parser, smaller payloads.

**Deviations**

- None from the plan. New constraint discovered: no `user` entity over SOAP, so
  Deal owner (required) needs a fallback owner / static map — logged as open
  item #1 in the Sage plan.

**What's next**

- Phase 7.1: schema migration `add_sage_sync` (sage*Id columns,
  `RecordSource.SAGE`, `SageSyncState`, `SageRecordSnapshot`). Then 7.2 client,
  7.3 mappings, 7.4a Mobile Mark test-slice import. Decide open items (owner
  fallback, amount = forecast vs total) before/at build.

### 2026-08-02 — Phase 5 human smoke complete; Phase 6 deferred (agent: Grok via Cursor)

**Plan / phase**: `docs/plans/m365-expansion.md` — Phase 5 DoD close-out;
Phase 6 decision.

**What was completed**

- Human smoke on `/follow-ups`: saw the suggested follow-up, accepted it,
  TASK was created, then cleared the task (happy path). Phase 5 marked
  DONE in Current state + plan DoD.
- Phase 6 reviewed with human and deferred:
  1. Outlook contacts import — skip (Screening-from-mail covers most
     cases; needs `Contacts.Read`).
  2. Meeting prep — already present in
     `apps/api/src/microsoft/outlook-calendar-sync.service.ts`
     (`prepareForMeeting` → `AgentTriggerService.meetingSoon`); plan
     bullet was stale.
  3. Teams digest — skip for now.

**How and why**

- Close Phase 5 on observed accept→task→clear rather than leaving open
  smoke. Record Phase 6 skip so the next agent does not re-propose those
  extras.

**Deviations**

- Phase 6 meeting-prep item was already implemented in Phase 2 MS calendar
  sync; plan text left as optional extras with a note in Current state.

**What's next**

1. Optional: Microsoft settings panel + sign-in visual pass vs upstream
   design refresh.
2. Phase 7 (Sage) only with a dedicated plan — do not start without one.
3. No Phase 6 work unless the human re-asks.

### 2026-08-02 — Phase 5 agent smoke (suggestions written) (agent: Grok via Cursor)

**Plan / phase**: `docs/plans/m365-expansion.md` — Phase 5 smoke
(curl/dispatch side).

**What was completed**

- Confirmed `AI_GATEWAY_API_KEY` present in root `.env`; restarted
  `apps/agent` (`eve dev` on `:2000`).
- Enqueue: `POST /internal/agent/followups` → `{"enqueued":1}`.
- Dispatch: `POST /eve/v1/dev/schedules/dispatch` →
  `{"scheduleId":"dispatch","sessionIds":["wrun_01KZ217NWH2NB5WF9VW3T3ZK01"]}`
  (HTTP 200). Turn completed with model tokens/cost; tools included
  `read_rep_followup_context` + `propose_followups`.
- DB: 1 `FollowUpSuggestion` PROPOSED (`reply-owed`, summary about Ten18
  antenna order). Evidence `messageId=cmsbxjv9j000cf48o6ippaxmi` exists in
  `emailMessage` (subject "Coming back at you"). `mailCount=8`.
- Left accept / snooze / dismiss + Priority prefs reshape to the human on
  `/follow-ups` (per request).

**How and why**

- Finished the blocked agent path without touching UI decisions the human
  owns. Gateway key was the missing piece from the prior handoff.

**Deviations**

- Only one suggestion this run (enough for evidence spot-check). Root
  session may still show `running` briefly under eve while the turn is
  already `completed` — suggestions were committed either way.

**What's next**

1. Human: on `/follow-ups`, accept one suggestion (confirm TASK on timeline
   + My open tasks), try snooze/dismiss, change Priority selects.
2. Check remaining Phase 5 DoD boxes in `docs/plans/m365-expansion.md`.
3. Phase 6 (asked): choose first extra — Outlook contacts → Screening,
   meeting prep `meetingSoon()`, or Teams digest webhook.

### 2026-08-02 — Phase 5 prefs smoke notes + Priority 3-col UI (agent: Grok via Cursor)

**Plan / phase**: `docs/plans/m365-expansion.md` — Phase 5 priority prefs
(follow-up polish + smoke).

**What was completed**

- Human smoke started: cron enqueue returns `{"enqueued":1}` once
  `CRON_SECRET` is read from root `.env` (bare `$CRON_SECRET` in the shell is
  empty → 403).
- Restarted API so `followups.prefs` / `pipeline` / `updatePrefs` exist
  (long-lived `bun run src/main.ts` does not pick up new routers). Fixed
  Priority card so a failed prefs query shows defaults instead of an endless
  spinner (`priority-prefs.tsx`).
- `FieldGroup layout="columns"` in `packages/ui` — Priority selects render as
  a 3-column row on `md+` (`md:grid-cols-3`).
- Documented: `eve dev` does **not** fire schedules on cron; trigger with
  `POST http://127.0.0.1:2000/eve/v1/dev/schedules/dispatch`. A triggered
  followups session failed: AI Gateway had no credentials
  (`AI_GATEWAY_API_KEY` / `eve link` OIDC). Synced mail exists (~8 messages);
  suggestions table still empty until the model can run.
- Plan already has Priority prefs + future on-page agent ask; no Phase 6 work.

**How and why**

- Separated UI/API wiring bugs from agent model auth so the next agent does
  not re-debug an empty Follow-ups page as a product bug.

**Deviations**

- None from the prefs design. Smoke DoD still incomplete without gateway key.

**What's next**

1. Add `AI_GATEWAY_API_KEY` to root `.env` (see `.env.example`), restart
   `apps/agent`, then:
   - optional re-enqueue:
     `curl -X POST -H "Authorization: Bearer $(grep '^CRON_SECRET=' .env | cut -d= -f2- | tr -d \"\\'\")" http://localhost:3001/internal/agent/followups`
   - `curl -X POST http://127.0.0.1:2000/eve/v1/dev/schedules/dispatch`
2. On `/follow-ups`: confirm suggestions with cited evidence; change Priority
   selects; accept / snooze / dismiss.
3. Check Phase 5 DoD boxes in `docs/plans/m365-expansion.md` when green.
4. Phase 6 only if asked.

### 2026-08-02 — Phase 5 priority prefs (filters + sweep bias) (agent: Grok via Cursor)

**Plan / phase**: `docs/plans/m365-expansion.md` — Phase 5 add-on
("Priority prefs").

**What was completed**

- Plan: added "Priority prefs (Phase 5 add-on)" — three selects, filter-first
  v1, daily sweep reads the same prefs, future on-page agent ask noted as not
  built. Phase 6 left alone.
- Schema: `FollowUpPreference` (`floatFirst` / `lookback` / `scope`) +
  migration
  `packages/db/prisma/migrations/20260802180000_add_followup_preference/`.
  Shared constants/helpers in `packages/db/src/followup-prefs.ts`.
- API: `followups.prefs`, `followups.updatePrefs`, `followups.pipeline`;
  `followups.list` filters/reorders by prefs. Regenerated
  `apps/api/src/generated/server.ts` (12 routers / 54 procedures).
- Agent: `loadFollowupPrefs` + lookback/scope in `repFollowupContext` /
  `proposeFollowUp`; `followupsPreamble` states the three biases.
- UI: `/follow-ups` Priority card (`priority-prefs.tsx`); deals lane uses
  `followups.pipeline`. Cache invalidation covers prefs + pipeline.
- `check-types` / `lint` / `test` pass. Migration applied locally.

**How and why**

- Prefs are mechanical filters (and light sweep prompt text), not intelligence
  in the API — matches `docs/api.md`. One DB row per rep so list and sweep
  stay aligned without a free-form chat UI yet.

**Deviations**

- `shared` means deals the rep owns **or** has logged activity on (no
  deal-membership table).
- On-page agent ask deferred (documented in plan only).

**What's next**

1. **Human smoke (Phase 5 DoD + prefs)**:
   - Connected Outlook mailbox with synced mail.
   - `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3001/internal/agent/followups`
   - Open `/follow-ups`: change Float first / Look back / Whose work; confirm
     list and deals lane reshape; accept / snooze / dismiss still work.
2. Phase 6 only if asked. Phase 7 needs its own plan.

### 2026-08-02 — Forked to jj-mobilemark/crm; main is now the real branch (agent: Sonnet via Cursor)

**Plan / phase**: Not a phase — repo ownership change requested by the human.

**What was completed**

- `origin` no longer points at `trycompai/crm` (it never had write access
  there — confirmed `viewerPermission: "READ"` before touching anything).
  Renamed that remote to `upstream`; created a fork at
  `github.com/jj-mobilemark/crm` and added it as the new `origin`.
- Pushed `m365-expansion` (commit `8d025d2`, all of Phases 0-5) to the fork.
- Fast-forwarded local `main` to `8d025d2` (a clean fast-forward — `main` was
  already an ancestor of `m365-expansion`, so no merge commit was needed) and
  pushed it to `origin/main`. The fork's default branch is `main`.
- Updated the "Current state" git-layout note above for the new remotes and
  the simpler go-forward workflow (work on `main` directly; pull upstream
  with `git fetch upstream && git merge upstream/main`).

**How and why**

- Human asked to commit and push; `git push` to the old `origin` would have
  failed outright (read-only), and even with access, pushing personal/company
  work-in-progress to someone else's public OSS repo without being asked
  would have been wrong. A fork is the correct destination, and the human
  confirmed: fork under their own account, merge `m365-expansion` into `main`
  so `main` is the full working CRM, and keep `upstream` around for pulling
  future `trycompai/crm` releases.

**Deviations**

- None from what was asked. `m365-expansion` branch was left in place on the
  fork (not deleted) in case anything ever needs to be diffed against it —
  it points at the same commit as `main` right now, so it costs nothing to
  keep.

**What's next**

1. Continue work directly on `main` from here — no more dual-branch
   maintenance for local-vs-upstream.
2. Everything under "Next step" below still applies (Phase 5 human smoke,
   then Phase 6 only if asked).

### 2026-08-02 — Phase 5 Follow-ups / Sales Cockpit (agent: Sonnet via Cursor)

**Plan / phase**: `docs/plans/m365-expansion.md` — Phase 5 implemented.

**What was completed**

- Schema: `FollowUpSuggestion` model (userId/contactId/companyId/dealId,
  kind, summary, capped `quote`, `dueHint`, `evidence` Json, status,
  `activityId`) + migration
  `packages/db/prisma/migrations/20260802155904_add_followup_suggestion/`.
  Additive `AgentTask.userId String?` + index in the same migration, for a
  per-rep task alongside the existing per-record ones.
- Agent (`apps/agent`): `agent/lib/followups.ts` (`repFollowupContext`,
  `proposeFollowUp` — verifies every cited message id exists before writing);
  tools `read_rep_followup_context.ts` (free read) and
  `propose_followups.ts` (one suggestion per call); `agent/lib/preamble.ts`
  gained `followupsPreamble` + a `userId` branch in `sessionPreamble`;
  `agent/instructions/task.ts` passes `attributes.userId` through;
  `agent/schedules/dispatch.ts` passes `userId` in session attributes and
  added the `"followups"` case to `work()`; `agent/lib/tasks.ts` carries
  `userId` through `claimDue`/`retireExhausted`/`completeTask`/`taskSubject`.
- API: `AgentTriggerService.followupsDue(userId, reason)`
  (`apps/api/src/agent/agent-trigger.service.ts`); new
  `apps/api/src/followups/` module — `followups.service.ts` (`list`,
  `decide`, `enqueueDue`), `followups.router.ts` (alias `followups`),
  `followups.controller.ts` (`GET|POST /internal/agent/followups`,
  `CRON_SECRET`-guarded like the sync routes), `followups.module.ts`;
  registered in `app.module.ts`; cron entry added to
  `apps/api/scripts/build-func.mjs` (`0 13 * * *`, once daily). Regenerated
  `apps/api/src/generated/server.ts` (12 routers / 51 procedures).
- UI: `apps/app/app/(app)/follow-ups/` — `page.tsx`, `suggestions-panel.tsx`
  (accept / snooze with quick presets / dismiss), `my-work-panels.tsx` (my
  open tasks + my active deals, reusing `activities.myTasks` and
  `deals.list`). Added to `app-icon-rail.tsx`. `useCrmCache` gained a
  `followup()` invalidation entry.
- Fixed a dropped `###` section header in this file's own work log (the
  Phase 3 entry had lost its heading during a previous edit) while I was in
  here.
- `check-types` (10/10), `lint` (7/7), `test` (7/7 task groups, incl. a new
  `TOOL_VERBS` entry each for the two new tools in
  `apps/app/lib/agent-transcript.ts`) all pass.

**How and why**

- See the "Done, with these deviations" note under Phase 5 in the plan doc
  for the four deviations from the original design (userId on `AgentTask`
  instead of a new table; API cron instead of an agent-side schedule; two
  tools instead of one; `CardPanel`/`SimpleTable` instead of `DataTable`) —
  each one is mechanical, not a scope change.
- Evidence verification lives in `proposeFollowUp`, not just the tool
  description: the project's own rule is that nothing is guessed, and a tool
  that only *asks* the model to cite something real is not the same as a tool
  that checks.

**Deviations**

- See above (plan doc has the full reasoning). Nothing outside Phase 5's
  intended scope.
- Also fixed, unrelated to Phase 5: local dev servers were down when this
  session started (killed during my own earlier smoke-testing on this
  machine). Restarted `apps/api` and `apps/app` directly rather than through
  root `bun run dev` — see "Current state" above.

**What's next**

1. **Human smoke (Phase 5 DoD)**:
   - Ensure at least one rep has a connected Outlook mailbox with real synced
     mail (Phase 2/3 state).
   - Trigger the sweep by hand:
     `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3001/internal/agent/followups`
     — expect `{"enqueued": <n>}`. This queues one `AgentTask` (`kind:
     "followups"`) per mailbox-connected rep; the agent's `dispatch.ts`
     schedule (`* * * * *` in dev) picks it up within a minute.
   - Open `/follow-ups`: suggestions should appear with cited evidence once
     the agent session finishes. Spot-check that a suggestion's `evidence`
     message ids are real (they are — `propose_followups` verifies this at
     write time — but confirm the UI shows something sensible).
   - Accept one: confirm a TASK activity appears on the named
     contact/company/deal's timeline AND in "My open tasks" here. Try snooze
     and dismiss too.
   - Confirm a second sweep does not duplicate an outstanding suggestion.
2. Root-cause the turbo/`bun --watch` dev-stack crash noted in "Current
   state" if it recurs — capture the exact log leading up to the silent
   exit next time (there was none to capture this session; the process was
   simply gone).
3. Once Phase 5 DoD is fully green: Phase 6 is optional-only work (only
   start if asked). Phase 7 (Sage CRM) is a separate track needing its own
   plan doc — do not start it from this plan.

### 2026-08-02 — Phase 4 Screening Room smoke confirmed (agent: Sonnet via Cursor)

**Plan / phase**: Phase 4 Definition of Done — human smoke test.

**What was completed**

- Human confirmed the three open Phase 4 DoD items: stranger mail produces a
  metadata-only `/screening` row, Approve creates a `Contact` (source `EMAIL`)
  and runs backfill, Reject-with-suppress holds the domain out via
  `SuppressedDomain`.
- Re-verified `check-types` (10/10), `lint` (7/7), `test` (api + agent + app,
  all green) on the current tree before moving on.
- Checked the remaining Phase 4 boxes in `docs/plans/m365-expansion.md`.
- Fixed a dropped section header in this file's work log (the Phase 3 entry
  had lost its `###` heading during a previous edit).

**Deviations**

- None.

**What's next**

1. Start **Phase 5 — Follow-ups / Sales Cockpit**
   (`docs/plans/m365-expansion.md` Phase 5): `FollowUpSuggestion` model +
   migration, `apps/agent` `propose_followups` tool on a daily per-rep task,
   `followups.router.ts`, `/follow-ups` UI (three lanes: suggestions / my
   open tasks / my active deals). Read the `eve` skill before touching
   `apps/agent`.

### 2026-08-02 — Phase 4 Screening Room (agent: Grok via Cursor)

**Plan / phase**: Phase 2 calendar DoD confirmed by human; Phase 4 implemented.

**What was completed**

- Human confirmed Phase 2 calendar: Outlook meeting with Jordan as attendee
  appeared as a MEETING activity on his timeline.
- Schema: `PendingContact` model + migration
  `packages/db/prisma/migrations/20260802170000_add_pending_contact/`.
- Harvest inside unmatched Outlook drop:
  `screening-harvest.service.ts` + hook in
  `outlook-mail-sync.service.ts` (metadata only — no bodies).
- API: `apps/api/src/screening/` — `list` + `decide` (`screening` tRPC alias);
  approve → `ContactsService.createFromScreening` (source `EMAIL`, backfill,
  `contactCreated` reason `"approved in screening room"`); reject + optional
  `suppressDomain` → `SuppressedDomain`.
- UI: `/screening` page + table with Approve / Reject + suppress checkbox;
  rail item in `app-icon-rail.tsx` (UserFollow icon).
- Regenerated `apps/api/src/generated/server.ts` (11 routers / 49 procedures).
- `check-types` / `lint` / `test` pass.

**Deviations**

- Screening list uses `Table` + `Empty` rather than `DataTable`, because
  `DataTable` requires URL query/pagination state that a short review queue
  does not need.

**What's next**

1. Human smoke: mail from a stranger (work domain, not in CRM) → sync → row
   on `/screening` (no thread/body stored). Approve → contact + backfill;
   Reject with suppress → domain stays out.
2. Start **Phase 5 — Follow-ups / Sales Cockpit** in
   `docs/plans/m365-expansion.md`.

### 2026-08-02 — Phase 3 EmailBackfill (agent: Grok via Cursor)

**Plan / phase**: Phase 2 DoD (mail) confirmed by human; Phase 3 implemented.

**What was completed**

- Human confirmed Phase 2 mail path: email from Ten18 Tech → Mobile Mark
  mailbox synced onto Jordan Johnson's timeline after sync.
- Phase 3 schema: `EmailBackfill` model + migration
  `packages/db/prisma/migrations/20260802160000_add_email_backfill/`.
- Enqueue on contact create / email change:
  `apps/api/src/contacts/contacts.service.ts` (`enqueueEmailBackfill`).
- Graph search + worker:
  - `outlook-mail.client.ts` `searchByParticipant` (`$search` +
    `ConsistencyLevel: eventual`)
  - `outlook-mail-backfill.service.ts` (≤3 addresses/tick, 5×50 pages,
    180-day cutoff, all connected Outlook mailboxes)
  - `OutlookMailSyncService.ingestMessage` reuses the Phase 2 store path
  - Wired at end of `MicrosoftSyncService.runDue` / `runForUser`
- Smoke: enqueued `jordan@ten18.tech` → sync wrote **7** messages (incl.
  June history before delta baseline); re-run wrote **0** (idempotent).
- `check-types` / `lint` / `test` pass.

**Deviations**

- Jordan was created before Phase 3 shipped, so the first smoke used a
  manual `EmailBackfill` upsert rather than contact-create enqueue. Create /
  email-change paths are wired for future contacts.

**What's next**

1. Human: open Jordan Johnson Activity — should show older Ten18 threads
   (not only today's sync).
2. Optional: calendar event with Jordan as attendee (Phase 2 leftover DoD).
3. Start **Phase 4 — Screening Room** in `docs/plans/m365-expansion.md`.

### 2026-08-02 — API dying / infinite contact tab spinners (agent: Grok via Cursor)

**Plan / phase**: Phase 2 unblock (local ops).

**What was completed**

- Contact sheet infinite spinners (Overview/Deals/Email filter/Agent) were not
  a contact-data bug: Nest on `:3001` was exiting, so React Query refetches
  never resolved. Activity "All" could still look fine briefly from cache.
- Cause: `apps/api` `dev` used `concurrently` with `bun --watch src/main.ts`
  **and** `nestjs-trpc watch` rewriting `src/generated/server.ts`. That rewrite
  SIGTERM-restarts Nest; `enableShutdownHooks()` exits cleanly, so bun --watch
  often does not bring the API back — leaving orphaned `nestjs-trpc` (PPID 1)
  and nothing on 3001. Mid-session `pkill` debugging made the flap worse.
- Fix in `apps/api/package.json`: `dev` is now only
  `bun --watch --no-clear-screen src/main.ts`. Added optional `dev:trpc` for
  intentional codegen watch. Router type regen stays
  `bun run --filter=api trpc:generate` (AGENTS.md).
- Hard-restarted `bun run dev` in its own session; API pid held `:3001` through
  a 45s health poll with no `nestjs-trpc watch` process.

**Deviations**

- Local `api:dev` no longer auto-watches routers for tRPC codegen (upstream
  did). Manual generate after router edits — matches AGENTS.md.

**What's next**

1. Human: hard-refresh, open Jordan Johnson, flip tabs — should not spin.
2. Finish Phase 2 smoke (mail to/from `jordan@ten18.tech` + sync).
3. Optional visual pass on MS settings vs new comp design system (prior log).
4. Then Phase 3.

### 2026-08-02 — Sync to upstream comp design system (288d41a) (agent: Opus via Cursor)

**Plan / phase**: Not a phase — a safe upstream update requested by the human
after finishing local Phase 2 work.

**What was completed**

- Committed ALL local work (74 files, Phases 0-2 + auth fallback +
  CompanyPicker + docs + `.cursor/`) as a safety snapshot on a new branch
  `m365-expansion` (commit `421e556`). `.env` stayed ignored; no secret was
  staged.
- Fast-forwarded `main` from `856ae2f` to upstream `288d41a` (15 commits: the
  "comp design system" UI overhaul, favicon resolver, row-hover prefetch,
  list-search-in-header, and small fixes).
- Merged `main` into `m365-expansion`. Result: **zero conflicts**. Only three
  files were touched on both sides — `AGENTS.md` and the two create sheets —
  and the edits sat in different line regions, so the 3-way merge combined
  them automatically (verified: CompanyPicker + upstream `<Button>` both
  present; both AGENTS.md sections present; no conflict markers).
- Verified the merged branch: `bun install` clean, `check-types` 10/10,
  `lint` 7/7, `test` 111 pass / 0 fail.

**How and why**

- Branch-first, commit-first because ALL work was uncommitted — a dirty-tree
  `git pull` would have aborted (3 shared files) and left no recovery point.
  The snapshot commit `421e556` is the fallback; `git merge --abort` was
  never needed.

**Deviations**

- None from the intended procedure. New vs upstream: this fork now keeps its
  auth-fallback + Microsoft additions on the `m365-expansion` branch;
  `main` is pure upstream.

**What's next (for the next agent)**

1. Do a visual pass on Microsoft settings
   (`apps/app/app/(app)/settings/microsoft-connection.tsx`) and the sign-in
   page against the new comp design system (flat white, one brand green — see
   `adrs/comp-palette.md` and `docs/design.md`). Several `packages/ui`
   components and design tokens changed.
2. Continue the Phase 2 Definition of Done smoke test (see the Phase 2 entry
   below and the plan).
3. Keep future upstream updates on the same branch discipline (see "Git
   layout" in Current state).

### 2026-08-02 — Phase 2 Microsoft mail + calendar sync (agent: Grok via Cursor)

**Plan / phase**: `docs/plans/m365-expansion.md` — Phase 2 (implementation).

**What was completed**

- Full Outlook sync module at `apps/api/src/microsoft/` (16 files), mirroring
  `apps/api/src/google/`:
  - Constants/contracts/token/Graph client/mail+calendar clients/message
    parser/match/mail-sync/calendar-sync/orchestrator/connection/conversation/
    router/controller/module.
  - Sources: `"outlook-calendar"` then `"outlook"` (Meetings first in UI).
  - Cron: `GET|POST /internal/sync/microsoft` + entry in
    `apps/api/scripts/build-func.mjs`.
  - Registered `MicrosoftModule` in `app.module.ts`.
  - Regenerated and committed path: `apps/api/src/generated/server.ts`
    (10 routers / 47 procedures).
- Shared cursor store: `SyncStateService.due(now, sources?)` filters by
  provider so Google and Microsoft ticks do not steal each other's rows;
  Google revoke only clears Google sources; `SyncStateService` exported from
  `GoogleModule` for Microsoft to import.
- Front end:
  - Replaced interim Settings panel with full
    `microsoft-connection.tsx` (mirrors Google card).
  - `settings/page.tsx` prefetches `microsoft.status`.
  - Timeline expand branches on `meta.source` (`outlook` /
    `outlook-calendar` → `microsoft.thread` / `microsoft.event`); deep links
    prefer Outlook URL when `outlookMessageId` is set.
  - `useCrmCache().microsoft()` added.
- Docs: `docs/local-setup.md` Settings note; plan Phase 2 front-end note.

**How and why**

- Graph mail delta has no cheap "now" token, so the first mail pass drains
  the inbox importing nothing, tagging the in-progress cursor with a
  `baseline:` prefix until `@odata.deltaLink` arrives (forward-only, like
  Gmail). Calendar uses `calendarView/delta` with a 180-day horizon.
- Microsoft token revoke clears stored DB tokens only (no simple public
  Graph revoke endpoint) — documented in `microsoft-token.service.ts`.
- nestjs-trpc collapses identically named Zod exports across routers into
  one import; Microsoft contracts use `ms*` names
  (`msSetAutoCreateInput`, etc.) so Google and Microsoft input types stay
  distinct in `generated/server.ts`.

**Deviations**

- Microsoft Zod contract export names are `ms*` (not identical to Google)
  — required for correct tRPC codegen.
- Mail baseline walks the full inbox once with zero imports (Graph
  limitation vs Gmail `historyId`); may take several cron ticks on a large
  mailbox before steady-state delta begins.
- `CRON_SECRET` was not set in this machine's `.env` at handoff time — the
  sync route fails closed without it. Human must set it before smoke test.

**What's next (for the next agent / human)**

1. **Human — Phase 2 smoke test** (plan Definition of Done):
   - Ensure `CRON_SECRET` is set in root `.env`; restart `bun run dev`.
   - `curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
     http://localhost:3001/internal/sync/microsoft` — expect a run summary.
   - First run(s): mail imports zero messages, records a cursor (baseline
     may span ticks; watch `MailboxSync` for sources `outlook` /
     `outlook-calendar`).
   - Send NEW mail to/from a CRM contact → sync again → thread on timeline
     with body on expand; stranger mail creates no rows.
   - Calendar event with known contact → MEETING activity.
   - Settings → Check now / toggles work.
2. When DoD is green, mark Phase 2 done in this file and start **Phase 3**
   (`EmailBackfill` model + enqueue on contact create/update + worker at end
   of Microsoft sync tick). Skills: `prisma-database-setup`,
   `nestjs-best-practices`.

### 2026-08-02 — Interim Microsoft Settings + Phase 1 closed (agent: Grok via Cursor)

**Plan / phase**: Phase 1 DoD closed; Settings interim ahead of Phase 2.

**What was completed**

- Confirmed Phase 1 smoke test in DB: microsoft account linked, refresh
  token present, scopes `Calendars.Read,email,Mail.Read,openid,profile,User.Read`.
- Settings no longer shows a broken Google "Needs attention" card when only
  Microsoft is configured:
  - New `apps/app/app/(app)/settings/microsoft-connection.tsx` — Connected /
    Needs attention / Not connected from `account.scope` + refresh token;
    Meetings/Email rows marked Coming soon; link to Microsoft account privacy.
  - `apps/app/app/(app)/settings/page.tsx` — prefers Microsoft panel when
    `MICROSOFT_*` set; Google card only if Google is configured and Microsoft
    is not; empty-state copy if neither.
- `docs/plans/m365-expansion.md` Phase 2 Front end — note that interim Settings
  exists and must be replaced (not duplicated) when `microsoft.status` lands.
- `docs/local-setup.md` — Settings note under Microsoft sign-in.

**How and why**

- Full Microsoft settings (sync now, auto-create, purge, revoke) are Phase 2
  work and need `microsoft.router` / MailboxSync. The Google card was actively
  wrong for this install (no Google grant → fake "refresh token" warning).
  An interim read-only Microsoft panel unblocks reps without starting Phase 2
  sync.

**Deviations**

- Shipped a partial Settings UI before Phase 2 — intentional, documented in
  the plan so the next agent replaces it rather than adding a second card.

**What's next (for the next agent)**

1. Read `AGENTS.md`, this file, then `docs/plans/m365-expansion.md` § Phase 2.
2. Skills: `nestjs-best-practices`, `nestjs-trpc`, `prisma-database-setup` if
   schema touches are needed (Phase 2 itself is mostly API mirroring; Phase 3+
   add models).
3. Create `apps/api/src/microsoft/` mirroring `apps/api/src/google/`
   file-for-file (plan lists each mapping). Register module + cron +
   `microsoft.router`; run `bun run --filter=api trpc:generate` and commit
   `apps/api/src/generated/server.ts`.
4. Replace `MicrosoftConnection` interim with a full card driven by
   `microsoft.status` (same UX as `google-connection.tsx`: Check now,
   toggles, purge, revoke). Do not keep rendering the Google card when
   Microsoft is the active provider.
5. Wire timeline expand for Outlook ids (`outlookMessageId` /
   `outlookEventId` already on schema from Phase 0b).
6. Stop when Phase 2 Definition of Done checklist is green; update this file.

### 2026-08-02 — Phase 1 fix: account_not_linked (agent: Grok via Cursor)

**Plan / phase**: `docs/plans/m365-expansion.md` — Phase 1 smoke-test fix.

**What was completed**

- Diagnosed `?error=account_not_linked` after Microsoft OAuth: user
  `jjohnson@mobilemark.com` existed as `credential` with
  `emailVerified = false`. Better Auth defaults
  `accountLinking.requireLocalEmailVerified` to `true`, so it refuses to
  link Microsoft onto that row.
- `packages/auth/src/auth.ts`:
  - `accountLinking.requireLocalEmailVerified: false` (allow-list is the
    real door; no verification email flow).
  - `databaseHooks.user.create.before` now returns `emailVerified: true`
    for allow-listed signups so new credential users do not hit this again.
- DB one-shot: set `emailVerified = true` for `jjohnson@mobilemark.com`.

**Deviations**

- None vs plan intent. Extra config flag beyond Phase 1 file list, required
  for email/password + Microsoft coexistence.

**What's next**

- Human: restart API/app (`bun run dev`), retry Microsoft sign-in. Confirm
  `account` row with `providerId = microsoft`. Then Phase 2.

### 2026-08-02 — Phase 0a collected + Phase 1 Microsoft SSO (agent: Grok via Cursor)

**Plan / phase**: `docs/plans/m365-expansion.md` — Phase 0a (human) + Phase 1.

**What was completed**

- Phase 0a: human registered Entra app `MM-CRM` (single-tenant) and set
  `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` in
  root `.env`. Confirmed present (values not logged).
- Phase 1 auth core:
  - `packages/auth/src/scopes.ts` — `MS_MAIL_SCOPE`, `MS_CALENDAR_SCOPE`,
    `MS_SYNC_SCOPES`, `hasMsSyncScopes()` (normalises Graph URI prefix).
  - `packages/auth/src/env.ts` — `microsoftCredentials()` (all three or none).
  - `packages/auth/src/auth.ts` — `socialProviders.microsoft` with
    `tenantId`, `scope: MS_SYNC_SCOPES`, `prompt: "select_account"`;
    `trustedProviders` includes `"microsoft"`.
  - `packages/auth/src/index.ts` — re-exports MS symbols.
- Phase 1 API / docs env:
  - `apps/api/src/config/env.validation.ts` — optional `MICROSOFT_*`.
  - `.env.example` — documents the three vars + redirect URI.
  - `docs/local-setup.md` — Microsoft sign-in notes.
- Phase 1 UI:
  - `packages/ui/src/components/brand-logos/microsoft.tsx`
  - `apps/app/app/(auth)/sign-in/microsoft-sign-in.tsx`
  - `apps/app/app/(auth)/sign-in/page.tsx` — Microsoft above Google when
    configured.
  - `apps/app/app/(auth)/grant-access/*` — prefers Microsoft when configured.
- Tests: `apps/api/test/google-scopes.spec.ts` — `hasMsSyncScopes` cases.
- Verification: `bun run check-types` pass; app lint pass; api tests pass
  (including new MS scope tests).

**How and why**

- Mirrored the existing optional-Google pattern so missing `MICROSOFT_*`
  hides the button and never throws. Better Auth already requests
  `openid`/`profile`/`email`/`User.Read`/`offline_access`; we only add
  `Mail.Read` + `Calendars.Read` for sync.
- `hasMsSyncScopes` accepts short names and
  `https://graph.microsoft.com/...` forms so the first real grant does not
  false-fail the gate.

**Deviations**

- None material. Grant-access still unused by the app shell (layout uses
  `requireSession()`, not a Microsoft gate) — same as the Google fork
  behaviour after email/password was enabled. Phase 2 sync will need a
  connection check of its own.

**What's next**

1. **Human smoke test (Phase 1 DoD)**: restart `bun run dev` if already
   running (so auth picks up `MICROSOFT_*`), open
   http://localhost:3000/sign-in, click **Continue with Microsoft**, consent
   to Mail + Calendar. Confirm:
   - Landing in the app succeeds.
   - Postgres `account` row: `providerId = 'microsoft'`, `refreshToken` set,
     `scope` contains mail + calendar.
   - Email/password sign-in still works.
2. **CHECKPOINT for next agent**: if stored scopes are unexpected, adjust
   `hasMsSyncScopes` / `parseScopes` (plan Phase 1 notes this).
3. **Phase 2** (`docs/plans/m365-expansion.md` § Phase 2): create
   `apps/api/src/microsoft/` mirroring `apps/api/src/google/` file-for-file.
   Read each Google file first. Skills: `nestjs-best-practices`,
   `nestjs-trpc`. Do not start until the human smoke test above succeeds.

### 2026-08-02 — Phase 0b schema prep (agent: Grok via Cursor)

**Plan / phase**: `docs/plans/m365-expansion.md` — Phase 0 (partial: 0b only).

**What was completed**

- Additive Prisma fields (no renames, no enum changes):
  - `EmailMessage.outlookMessageId String?` in
    `packages/db/prisma/schema.prisma` (mirrors `gmailMessageId`).
  - `CalendarEvent.outlookEventId String?` in the same file (mirrors
    `googleEventId`).
- Migration created and applied against local Postgres:
  `packages/db/prisma/migrations/20260802135359_add_outlook_ids/migration.sql`
  (`ALTER TABLE` only — two nullable TEXT columns).
- `bun run check-types` passed after migrate + generate.

**How and why**

- Followed Phase 0b exactly: keep `GoogleSyncStatus` and Google id columns;
  only add Outlook deep-link ids so Phase 2 sync can store them without a
  later migration. `MailboxSync.source` stays a plain string; Microsoft will
  use `"outlook"` / `"outlook-calendar"` at write time (no schema change).

**Deviations**

- None for 0b.
- Phase 0a (Entra registration) was **not** done — it is a manual Azure
  portal step. Asked the user whether the app is already registered or they
  will supply `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and
  `MICROSOFT_TENANT_ID`. Until those exist, Phase 0 Definition of Done is
  incomplete (migration + types are done; Entra + `.env` are not).

**What's next**

1. **Human — Phase 0a** (plan §0a): Azure portal → Entra ID → App
   registrations → New registration named `MM-CRM`, single-tenant.
   - Redirect URI (Web):
     `http://localhost:3001/api/auth/callback/microsoft`
   - Secret: create one, copy the **value** into root `.env` only (never into
     HANDOFF or git).
   - Delegated Graph permissions + admin consent: `User.Read`, `Mail.Read`,
     `Calendars.Read`, `offline_access`, `openid`, `profile`, `email`.
   - Put into root `.env` (and later `.env.example` docs in Phase 1):
     `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`.
   - Update this file's Current state: mark 0a as collected (do **not** paste
     the secret here).
2. **Next agent — Phase 1** (`docs/plans/m365-expansion.md` § Phase 1):
   Microsoft SSO via Better Auth. Read
   `.agents/skills/better-auth-best-practices/SKILL.md` first. Touch in
   order: `packages/auth/src/scopes.ts`, `env.ts`, `auth.ts`; then
   `apps/api/src/config/env.validation.ts`; `.env.example`; sign-in +
   grant-access UI. Mirror the existing optional Google pattern so missing
   `MICROSOFT_*` hides the button and never throws.
3. Do **not** start Phase 2 until Phase 1 DoD is satisfied.

### 2026-08-02 — Initial setup, auth fallback, UX fixes, M365 plan (agent: Fable via Cursor)

**What was completed**

- Cloned and set up `trycompai/crm` in this repo: installed Bun 1.3.12,
  started the docker-compose Postgres, created the root `.env` from
  `.env.example` (`BETTER_AUTH_SECRET` generated, `ALLOWED_SIGN_IN` set,
  `DATABASE_URL` matching compose), ran migrations and the demo seed.
- Cursor project scaffolding: rules in `.cursor/rules/` (`project-overview`,
  `local-dev`, `skills-and-docs`), setup tracking doc `docs/local-setup.md`,
  and `.cursor/skills/` symlinks into the canonical `.agents/skills/` so the
  bundled skills work in Cursor as well as Claude Code.
- Enabled email/password auth so the app is usable without a Google OAuth
  client:
  - `packages/auth/src/auth.ts` — `emailAndPassword.enabled: true`.
  - `packages/auth/src/client.ts` — export `signUp`.
  - `apps/api/src/config/env.validation.ts` — `GOOGLE_CLIENT_ID`/`SECRET`
    made optional (were required).
  - `apps/app/app/(app)/layout.tsx` — gate relaxed from
    `requireGoogleAccess()` to `requireSession()`.
  - `apps/app/app/(auth)/sign-in/credentials-form.tsx` — new sign-in /
    register form; `page.tsx` renders it and shows the Google button only
    when Google creds are configured.
- Replaced the plain company `<Select>` with a searchable, debounced
  typeahead: new `apps/app/components/crm/company-picker.tsx`, used in
  `apps/app/app/(app)/deals/create-deal-sheet.tsx` and
  `apps/app/app/(app)/contacts/create-contact-sheet.tsx`.
- Wrote the Microsoft 365 expansion plan: `docs/plans/m365-expansion.md`.

**How and why**

- Email/password was the fastest safe way in (org uses Microsoft 365, so a
  Google OAuth client was pointless); the `ALLOWED_SIGN_IN` allow-list still
  guards registration, so the authorisation model is unchanged.
- CompanyPicker exists because the org will import thousands of companies
  from their existing CRM — a static dropdown doesn't scale. It queries
  `companies.options` via tRPC with a debounced search term.

**Deviations from upstream**

- Upstream assumes Google-only sign-in and gates the whole app on granted
  Gmail/Calendar scopes. This fork treats Google (and later Microsoft) sync
  as optional capabilities and gates only on a valid session. Documented in
  `docs/local-setup.md` › "Auth changes from upstream".

**What's next**

- Execute `docs/plans/m365-expansion.md` starting at **Phase 0** (Entra app
  registration is a manual human step in the Azure portal — ask the user to
  do it or to provide the three `MICROSOFT_*` values; the schema prep half of
  Phase 0 is agent work). Then Phase 1 (Microsoft SSO), and so on, one phase
  at a time. Each phase ends with its Definition of Done checklist and an
  update to this file.
