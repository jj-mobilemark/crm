# HANDOFF-SAGE-SYNC.md — Sage push write-back

Dedicated handoff for the **local → Sage CRM push** work (plan:
`.cursor/plans/sage_push_write-back_7ae8cdad.plan.md`, canonical design:
`docs/plans/sage-crm-sync.md`). Read this **before** continuing Sage push work.
Keep the main `HANDOFF.md` for other tracks; update **both** when you stop.

## How to update this file

- **Append, never rewrite history.** New dated entry at the top of "Work log".
- Each entry: what completed (with paths), how/why, deviations, what's next.
- Keep **Current state** edited in place.

---

## Current state (2026-08-03)

### Verdict vs plan

| Plan phase | Status | Notes |
| --- | --- | --- |
| 0 Verify SOAP `add`/`update` | **DONE** (live) | Variant A envelope confirmed. Opp 557 update restored. Add created **opp `805`** on company 24 (`forecast=1`) — **delete in Sage**. |
| 1 `SageOutbox` schema | **DONE** | Migration `20260803120000_add_sage_outbox` (already applied locally). |
| 2 Reverse mappings | **DONE** | `toSage*` in `sage.mappings.ts` + unit tests. |
| 3 `SagePushService.flush()` | **DONE** | Outbox drain under `withSageSession`, 3 retries, parent-before-child. |
| 4 Human UI enqueue hooks | **DONE** | Companies / contacts / deals create+update (+ deal `setStage`). **+ Screening Approve** when parent has `sageCrmCompanyId` and no same-name Sage twin. **+ contact fact accept** for `title` / `name` (`decideFact`). |
| 5 Immediate + periodic flush | **DONE** | `enqueueAndKick` + cron drains after pull on `/internal/sync/sage`. |
| 6 Tests + smoke | **PARTIAL** | Unit tests green. Screening→Sage + UI→outbox smoke still owed in browser. |
| Docs | **DONE** | This file + `sage-crm-sync.md` §4 6c / §5 item 7 updated. |

### Related: pipeline change log (not push, but touches pull)

Pull diffs on deals (when **not** a push echo) now append `DealFieldChange`
rows (`source: sage`) via `DealChangeRecorder` in `SagePullService.upsertDeal`.
That feeds the overview pulse / pipeline agent (`docs/plans/pipeline-pulse.md`).
Echo-guard still skips mapped-field overwrite **and** skips change-log rows on
echo, so a local push does not double-count.

### Locked decisions (do not relitigate)

- **Scope**: UPDATE + CREATE for company / contact / deal.
- **Create trigger**: human UI create/update, **plus Screening Approve** when
  the parent company already has `sageCrmCompanyId` and no same-name
  Sage-linked twin sits on that company. Still not agent / Google /
  Microsoft auto-create / Sage pull. Screening enqueue failures never fail
  the local create (outbox is best-effort).
- **Timing**: durable `SageOutbox`; best-effort immediate flush; max **3** attempts then `failed`.
- **Conflict**: **local wins** on mapped fields. Pull echo-guard skips Sage rows whose `updateddate` ≤ local `sagePushedAt`.

### Confirmed SOAP write shape (Phase 0)

```
<tem:update|add>
  <tem:entityname>opportunity|company|person</tem:entityname>
  <tem:records xsi:type="typens:<entity>">
    <typens:fieldname>value</typens:fieldname>
    …
  </tem:records>
</tem:update|add>
```

- Namespaces: request `http://tempuri.org/`, types `http://tempuri.org/type`.
- Field names are **short** (same as query response), not `oppo_`/`comp_`/`pers_` predicates.
- **Update** response: `<numberupdated>1</numberupdated><updatesuccess>true</updatesuccess>`.
- **Add** response: `<crmid>805</crmid>` (not `<opportunityid>`). Client: `parseAddId`.
- Probe: `apps/api/scripts/sage-push-probe.ts`
  - `--logon-only` / `--update` / `--add`
  - Test targets: opp **557**, company **24**.

### Cleanup owed in Sage

- Opportunity **`805`** on company 24 — throwaway add probe (`PUSH PROBE ADD A …`, forecast `$1`). Delete manually in Sage CRM.

### Key files

| Path | Role |
| --- | --- |
| `apps/api/src/sage/sage-soap.client.ts` | `add` / `update` + `writeBody` |
| `apps/api/src/sage/sage-xml.ts` | `parseAddId`, `parseUpdateResult` |
| `apps/api/src/sage/sage.mappings.ts` | `toSage*Fields`, `sageStageForPush`, `isPushEcho`, `sageUserIdForEmail` |
| `apps/api/src/sage/sage-push.service.ts` | `enqueue`, `enqueueAndKick`, `flush` |
| `apps/api/src/sage/sage-pull.service.ts` | echo-guard on company/contact/deal upserts; stamps `sageUpdatedAt` |
| `apps/api/src/sage/sage-sync.controller.ts` | returns `{ pull, push }` after scheduled sync |
| `apps/api/src/sage/sage.module.ts` | exports `SagePushService` |
| `apps/api/src/{companies,contacts,deals}/*` | import `SageModule`; UI create/update kick push |
| `packages/db/prisma/schema.prisma` | `SageOutbox` model (`@@map("sageOutbox")`) |
| `packages/db/prisma/migrations/20260803120000_add_sage_outbox/` | migration |
| `apps/api/scripts/sage-push-probe.ts` | live write-shape probe |
| `apps/api/test/sage-mappings.spec.ts` | reverse mapping + echo tests |
| `apps/api/test/sage-xml.spec.ts` | add/update parse tests |

### Flow

```
Human tRPC mutation
  → Companies/Contacts/DealsService (actor from @Ctx)
  → DB write
  → SagePushService.enqueueAndKick(entity, localId, actorId)
       → SageOutbox pending row (dedupe per entity+localId)
       → void flush()  // best-effort; never blocks UI

Nightly /internal/sync/sage (CRON_SECRET)
  → pull.runScheduled()
  → push.flush()      // same advisory lock rule; sequential, not concurrent
```

### Known gaps / next agent work

1. **Human smoke (highest priority)**  
   - Restart API (`bun run src/main.ts` in `apps/api` — no hot reload).  
   - Edit deal **557** locally (name / certainty / amount) → confirm Sage opp updates.  
   - Create a small local deal under company 24 → confirm Sage create + `sageCrmOpportunityId` written back.  
   - Confirm next incremental pull does **not** overwrite the local edit (echo-guard).  
   - Delete Sage opp **805**.

2. **Nested company fields not pushed**  
   Company phone/email/address and contact email/phone are **not** in `toSageCompanyFields` / `toSagePersonFields` (flat write cut). Catalog §3 maps them on pull; push of nested children is a later phase.

3. **Failed outbox UI**  
   Rows park as `status=failed` after 3 attempts; no admin UI / retry button yet. Query:  
   `SELECT * FROM "sageOutbox" WHERE status IN ('pending','failed') ORDER BY "createdAt";`

4. **Reconcile soft-deactivate** (`sageDeactivatedAt`) still DESIGN-ONLY (`sage-crm-sync.md` §6.7).

5. **`sage.router.ts` status/syncNow** still not built (cron uses CRON_SECRET HTTP route).

6. **Lease-row lock upgrade** still deferred (`withSageSession` advisory-lock caveat with pooling — documented in `sage-session.ts`).

7. **Cron response shape changed** — `/internal/sync/sage` now returns `{ pull, push }` instead of the bare pull summary. Any external monitor that expected the old shape needs updating.

### Verification already run

- Live: `sage-push-probe.ts --logon-only` OK; `--update` on 557 OK + restored; `--add` created **805**.  
- `bun test test/sage-mappings.spec.ts test/sage-xml.spec.ts` — 44 pass.  
- `bunx tsc --noEmit` in `apps/api` — green.  
- `prisma migrate deploy` — outbox migration already applied.

---

## Work log (newest first)

### 2026-08-04 — Fact accept (title/name) enqueues Sage push

**What was completed**
- `contacts.decideFact` accepts for `title` or `name` now call
  `sagePush.enqueueAndKick`, same as Details field saves.
- File: `apps/api/src/contacts/contacts.service.ts`.

**How and why**
- Reps often accept a signature title and leave; without this, Sage
  never gets the update unless they edit another pushable field.

**Deviations**
- None. Profile-URL facts still local-only (not in person push map).

**What's next**
- Soft smoke accept → outbox → Sage title. Lindsay's prior accept needs
  a one-time re-save after deploy.

### 2026-08-03 — Screening Approve enqueues Sage person create

**What was completed**
- Screening Approve best-effort pushes when parent has `sageCrmCompanyId`
  and no same-name Sage-linked twin at that company.
- Local create never fails on enqueue/flush errors.
- Decide returns `sagePushQueued`; toast says "queued for Sage" when true.
- Locked create-trigger decision + `sage-crm-sync.md` §4/§5 updated.
- Files: `contacts.service.ts`, `screening.service.ts`,
  `screening-table.tsx`, this handoff, `sage-crm-sync.md`.

**How and why**
- Approve is a human choice onto a known Sage company; without push the
  contact stays CRM-only and pull cannot invent a Sage person.

**Deviations**
- Nested person email/phone still not in the push mapping (pre-existing).

**What's next**
- Soft check Approve → outbox → `sageCrmContactId` stamped.
- Optional later: nested email on person create so Sage shows the address.

### 2026-08-03 — Note: DealFieldChange on Sage pull (pipeline pulse)

**What was completed (adjacent track)**
- `SagePullService.upsertDeal` records field diffs to `DealFieldChange` when
  the update is **not** a push echo (`source: sage`). Same echo-guard as
  mapped-field overwrite. See `docs/plans/pipeline-pulse.md` and main
  `HANDOFF.md`.

**How and why**
- Overview pulse needs forward-only change history; pull is a primary source
  of opportunity moves. Logging on echo would double-count local UI edits that
  were already written with `source: app`.

**Deviations**
- None for push itself — push phases unchanged; E2E smoke still owed.

**What's next**
- Unchanged: delete Sage opp **805**; restart API; smoke UI edit of deal 557
  + create under company 24; confirm echo-guard on next pull.

### 2026-08-03 — Sage push write-back wired end-to-end (agent: Cursor)

**Plan**: `sage_push_write-back_7ae8cdad.plan.md` Phases 0–6.

**What was completed**

- **Phase 0 live verify**: SOAP write shape confirmed (variant A). Update on opp 557 worked and was restored. Add under company 24 created opp **805** (`crmid`). Probe logging fixed to read `<crmid>`.
- Scaffolding already present from prior WIP was completed/wired:
  - SOAP `add`/`update` in `sage-soap.client.ts`
  - `SageOutbox` + `SagePushService`
  - Reverse mappings `toSage*`
- **Enqueue hooks**: actor threaded into companies/contacts routers; `enqueueAndKick` from human create/update (+ deal `setStage`). Screening/`EMAIL` creates do **not** enqueue.
- **Cron flush**: `SageSyncController` runs pull then `push.flush()`.
- **Echo-guard**: pull upserts skip mapped-field overwrite when `isPushEcho(sageUpdatedAt, sagePushedAt)`; still stamps `sageUpdatedAt`.
- **Tests**: reverse mappings + parseAddId/parseUpdateResult + isPushEcho.
- **Docs**: `docs/plans/sage-crm-sync.md` §5.7 → BUILT; this handoff file created.

**How and why**

- Durable outbox + kick matches single-session / slow SOAP constraints without blocking UI saves.
- Local-wins + echo-guard prevents the nightly pull from undoing a rep's edit that we just pushed.
- Human-only enqueue keeps Google/Microsoft/agent/screening from flooding Sage with creates.

**Deviations**

- Cron response is now `{ pull, push }` (plan said "extend the route"; shape change is the concrete form).
- Company/contact nested phone/email/address still not pushed (same as the existing reverse-mapping cut — documented, not expanded).
- E2E UI smoke left for the human/next agent (API must be restarted first).
- Probe initially logged `new id=null` because it looked for `opportunityid` instead of `crmid` — fixed; real id is **805**.

**What's next**

1. Delete Sage opportunity **805**.
2. Restart API; smoke edit deal 557 + create a tiny deal under company 24.
3. Optionally add failed-outbox visibility in settings.
4. Do **not** start reconcile soft-deactivate unless asked (`§6.7`).
)
