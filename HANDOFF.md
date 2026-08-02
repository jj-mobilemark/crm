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

- **Git layout (NEW)**: local work now lives on branch **`m365-expansion`**.
  `main` tracks upstream `trycompai/crm` and was fast-forwarded to `288d41a`
  (the "comp design system" release). Upstream was merged INTO
  `m365-expansion` with zero conflicts. The pre-merge snapshot of all local
  work is commit `421e556`. To keep updating in future: commit on
  `m365-expansion`, `git checkout main && git merge --ff-only origin/main`,
  then `git checkout m365-expansion && git merge main`.
- **Upstream delta absorbed**: the new release restyled ~40 `packages/ui`
  components + `globals.css`, split the company overview, added a favicon
  resolver, and added row-hover prefetch. This is cosmetic/mechanical and did
  not touch the Microsoft module. **Visual pass still needed** on the
  Microsoft settings panel and sign-in page against the new design system.
- **Verification**: `check-types` 10/10, `lint` 7/7, `test` 111 pass / 0 fail
  (api; agent 116).
- **Runs locally**: Bun 1.3.12 monorepo; Postgres via `docker compose up -d`;
  `bun run dev` serves app on :3000 and API on :3001. Setup details in
  `docs/local-setup.md`. **API `dev` script no longer runs `nestjs-trpc watch`
  alongside `bun --watch`** (that combo was killing `:3001`). After router
  edits: `bun run --filter=api trpc:generate`.
- **Auth**: email + password (fallback), allow-list
  `ALLOWED_SIGN_IN=mobilemark.com`. **Microsoft SSO works end-to-end** for
  `jjohnson@mobilemark.com`: `account` row `providerId=microsoft`,
  `refreshToken` present, scope includes `Mail.Read` + `Calendars.Read`
  (short names). Google OAuth still optional / unconfigured.
  `MICROSOFT_*` + `CRON_SECRET` set in root `.env` (secrets never recorded here).
- **Settings**: full Microsoft 365 card via `microsoft.status` (Check now,
  auto-create, purge, revoke). Google card only when Google is configured and
  Microsoft is not.
- **Smoke-test contacts (local DB only)**: Jordan Johnson ·
  `jordan@ten18.tech` · Ten18 Tech; also Nicole Zandier · `nicolez@dsdinc.com`
  · DSD Inc.
- **Active plan**: `docs/plans/m365-expansion.md` (Phases 0–7).
- **Phase 0**: DONE. **Phase 1**: DONE. **Phase 2**: DONE (mail + calendar
  meeting smoke confirmed by human). **Phase 3**: DONE. **Phase 4**: DONE
  (human confirmed the Screening Room smoke — stranger mail → row → approve
  creates a contact + backfill, reject-with-suppress holds the domain out).
  **Phase 5**: code DONE — human smoke still open (needs a mailbox-connected
  rep with real synced mail, then a run of the daily sweep).
- **Next step**: Human smoke for Phase 5 Follow-ups (see the newest work-log
  entry below for exact steps). After that, Phase 6 is optional-only
  (`docs/plans/m365-expansion.md` Phase 6) and Phase 7 is a separate,
  not-yet-started track. Optional visual pass on MS settings vs new comp
  design system.
- **Dev servers locally right now**: running as two direct background
  processes (`bun run src/main.ts` in `apps/api`, `bun run dev` in
  `apps/app`) rather than through root `bun run dev` / turbo — the
  turbo-orchestrated stack has been dying silently a few seconds after
  logging "successfully started" in this session (API log shows no error,
  the process is just gone; `apps/api`'s `bun --watch` combined with
  `@crm/db`'s `prisma generate --watch` is the suspect, not yet root-caused).
  Direct `bun run` processes have been stable. If you restart normally with
  root `bun run dev` and it dies the same way, this is why — fall back to
  running `apps/api` and `apps/app` `dev` scripts directly in two terminals
  until it's root-caused.

## Work log (newest first)

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
