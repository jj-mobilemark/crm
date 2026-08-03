# Microsoft 365 Expansion — Execution Plan

This is the canonical copy of the plan. It is written so that an agent with
limited context can execute it phase by phase with minimal guesswork.

## How to use this plan (read this first, every session)

1. Read `AGENTS.md` at the repo root, then `HANDOFF.md` at the repo root.
   `HANDOFF.md` says exactly where the previous agent stopped and what is next.
2. Read the skill for the area you are touching (they live in
   `.cursor/skills/`, canonical source `.agents/skills/`):
   - Auth work → `better-auth-best-practices`
   - Prisma schema / migrations → `prisma-database-setup`
   - API work → `nestjs-best-practices` and `nestjs-trpc`
   - Agent work → `eve` (full docs also in `apps/agent/node_modules/eve/docs`)
   - Front end → `shadcn`, `nuqs`, `no-use-effect`, `vercel-react-best-practices`
3. Execute ONE phase at a time, in order. Do not start a phase until the
   previous phase's "Definition of done" checklist is fully satisfied.
4. When you finish a phase — or stop for any reason — update `HANDOFF.md`
   (protocol described in `AGENTS.md`). This is not optional.

### Hard rules (violating these is a bug)

- ONE `.env` at the repo root. Every new variable goes into `.env.example`
  with a comment. Every variable the API reads is also declared in
  `apps/api/src/config/env.validation.ts`. Never add a per-package `.env`.
- Missing optional config removes a capability; it must never throw.
  (Pattern: `packages/auth/src/env.ts` `googleCredentials()` and
  `apps/agent/agent/lib/capabilities.ts`.)
- Intelligence never lives in the API (`docs/api.md`). Mechanical work in
  NestJS is fine (fetch tokens, call Microsoft Graph, match email addresses,
  store rows). Deciding what data MEANS (identity, follow-ups, briefs) lives
  in `apps/agent`.
- UI components come only from `packages/ui`. No style overrides at call sites.
- Never let `build` regenerate `apps/api/src/generated/server.ts`. After
  changing/adding any `*.router.ts`, run `bun run --filter=api trpc:generate`
  and commit the regenerated file.
- No real customer names/emails in fixtures, tests, screenshots or docs.
- Do not add an `organizationId`. Single tenant, deliberately.

### Verification commands (run after every phase)

```bash
bun run check-types      # tsc everywhere — must pass
bun run lint             # biome — must pass
bun run test             # must pass
bun run dev              # manual smoke test on http://localhost:3000
```

The local dev environment (Bun, Docker Postgres, .env) is already set up —
see `docs/local-setup.md`. Sign in locally with email/password.

## Decisions already made (do not relitigate)

- Microsoft 365 REPLACES Google as the real identity/data provider.
  Email + password stays enabled as the fallback (it already works today).
- Mail sync is FULL-BODY but MATCHED-ONLY: bodies are stored, but only for
  threads that resolve to a Contact/Company already in the CRM. Unmatched
  mail is never stored (participant metadata may go to the Screening Room).
- BACKFILL on contact-add: adding a contact you already email triggers a
  targeted Graph import of that address's recent history.
- Agent-detected follow-ups are suggestions; ACCEPTING one creates a real
  CRM task (`Activity` of type `TASK`) linked to the contact/deal.
- The Follow-ups panel is PER-REP (my mailbox, my deals, my follow-ups).

## Why this is close to what already exists

The Google pipeline in `apps/api/src/google/` already stores bodies in
`EmailMessage.body`, projects one `Activity` per thread, and only keeps
threads that `GoogleMatchService.resolve()` ties to a known Contact/Company.
Phase 2 is that pipeline re-pointed at Microsoft Graph. The genuinely new
pieces are backfill (Phase 3), the Screening Room (Phase 4), and the
Follow-ups panel (Phase 5).

## Target architecture

```mermaid
flowchart LR
  rep[Rep browser] -->|Entra SSO| app[Next.js app]
  app -->|session cookie| api[NestJS API]
  api -->|Better Auth: microsoft| entra[Entra ID]
  api -->|tokens| db[(Postgres)]

  cron[Cron] -->|/internal/sync/microsoft| api
  api -->|delegated token| graph[MS Graph]
  api -->|matched threads + bodies| db

  addcontact[Add contact] -->|backfill row| api
  api -->|targeted Graph query by address| graph

  rep -->|Follow-ups panel| app
  agent[eve agent] -->|reads synced mail + deals| db
  agent -->|FollowUpSuggestion rows| db
  rep -->|accept| task["Activity TASK"]
```

## Baseline: how this fork already differs from upstream

(Recorded in detail in `HANDOFF.md`. Summary so nothing surprises you.)

- Email/password auth is ENABLED (`packages/auth/src/auth.ts`), Google env
  vars are OPTIONAL (`apps/api/src/config/env.validation.ts`), and the app
  shell gate is `requireSession()` not `requireGoogleAccess()`
  (`apps/app/app/(app)/layout.tsx`).
- The sign-in page has an email/password form; the Google button renders only
  when Google creds are set (`apps/app/app/(auth)/sign-in/page.tsx`).
- A searchable `CompanyPicker` (`apps/app/components/crm/company-picker.tsx`)
  replaced the plain company dropdown in the create-deal and create-contact
  sheets.

---

## Phase 0 — Entra app registration + additive schema prep

Goal: credentials exist, and the schema can hold Microsoft identifiers.
No user-facing change.

### 0a. Entra app registration (MANUAL — a human does this in the Azure portal)

Record the resulting values in `HANDOFF.md` as "collected" (never paste the
secret itself into any file except `.env`).

1. Azure portal → Microsoft Entra ID → App registrations → New registration.
2. Name: `MM-CRM`. Supported account types: "Accounts in this organizational
   directory only" (single tenant).
3. Platform: Web. Redirect URI: `http://localhost:3001/api/auth/callback/microsoft`
   (Better Auth mounts callbacks at `/api/auth/callback/{provider}` on the API,
   which is port 3001 locally). Add the production API origin later.
4. Certificates & secrets → New client secret → copy the secret VALUE.
5. API permissions → Add → Microsoft Graph → Delegated:
   `User.Read`, `Mail.Read`, `Calendars.Read`, `offline_access`, `openid`,
   `profile`, `email`. Then "Grant admin consent" for the tenant.
6. Collect: Application (client) ID, Directory (tenant) ID, client secret value.

### 0b. Schema changes (ADDITIVE ONLY — do not rename existing enums/columns)

Renaming `GoogleSyncStatus` or `gmailMessageId` is cosmetic and risky; skip it.
Reuse the existing enum — its values (`IDLE/RUNNING/NEEDS_RECONNECT/FAILED`)
are provider-neutral.

Edit `packages/db/prisma/schema.prisma`:

- `EmailMessage`: add `outlookMessageId String?` (deep-link id, mirrors
  `gmailMessageId`).
- `CalendarEvent`: add `outlookEventId String?` (mirrors `googleEventId`).
- `MailboxSync.source` is already a plain `String` — no schema change needed.
  Microsoft rows will use the new source values `"outlook"` (mail) and
  `"outlook-calendar"` (calendar) to avoid colliding with Google's
  `"gmail"`/`"calendar"` rows.

Then run `bun run db:migrate` (it creates and applies a migration; name it
`add_outlook_ids`).

### Definition of done (Phase 0)

- [ ] Entra values collected and placed in `.env` (see Phase 1 var names)
- [ ] Migration applied; `bun run check-types` passes
- [ ] `HANDOFF.md` updated

---

## Phase 1 — Microsoft SSO replaces Google

Goal: the team signs in with their Microsoft 365 account.

### Files and edits

- `packages/auth/src/scopes.ts` — add Microsoft scope constants alongside the
  Google ones:
  - `MS_MAIL_SCOPE = "Mail.Read"`, `MS_CALENDAR_SCOPE = "Calendars.Read"`,
    `MS_SYNC_SCOPES = [MS_MAIL_SCOPE, MS_CALENDAR_SCOPE]`.
  - Add `hasMsSyncScopes(scope)` mirroring `hasSyncScopes()`.
  - CHECKPOINT: after your first real sign-in, inspect the `account.scope`
    column for the microsoft row and make sure the stored strings match what
    `hasMsSyncScopes` checks (Microsoft may return scopes as short names or
    full `https://graph.microsoft.com/...` URIs — normalize in `parseScopes`
    if needed).
- `packages/auth/src/env.ts` — add `microsoftCredentials()` mirroring
  `googleCredentials()`: reads `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`,
  `MICROSOFT_TENANT_ID`; all three required together, else `undefined`
  (half-set throws with a clear message). Export as `env.microsoft`.
- `packages/auth/src/auth.ts` — mirror the `if (env.google)` block:

```ts
if (env.microsoft) {
  socialProviders.microsoft = {
    clientId: env.microsoft.clientId,
    clientSecret: env.microsoft.clientSecret,
    tenantId: env.microsoft.tenantId,
    scope: [...MS_SYNC_SCOPES],   // Better Auth adds identity scopes itself
    // consult the better-auth skill/docs for exact option names on the
    // microsoft provider (e.g. prompt, authority) — verify before writing
  };
}
```

  Also add `"microsoft"` to `account.accountLinking.trustedProviders`.
- `apps/api/src/config/env.validation.ts` — add the three `MICROSOFT_*` vars
  as `@IsOptional() @IsString()` (same as the Google ones are now).
- `.env.example` — document the three vars with the redirect URI note.
- `apps/app/app/(auth)/sign-in/microsoft-sign-in.tsx` — copy
  `google-sign-in.tsx`, change provider to `"microsoft"` and the label to
  "Continue with Microsoft". If `packages/ui/src/components/brand-logos/` has
  no Microsoft logo, add `microsoft.tsx` there (4-square mark, plain SVG,
  same component shape as `google.tsx`).
- `apps/app/app/(auth)/sign-in/page.tsx` — add
  `const microsoftEnabled = Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET && process.env.MICROSOFT_TENANT_ID)`
  and render the Microsoft button (above the Google block, same
  `FieldSeparator` pattern).
- `apps/app/app/(auth)/grant-access/grant-access.tsx` — support
  `linkSocial({ provider: "microsoft", scopes: [...MS_SYNC_SCOPES] })` when
  Microsoft is configured.

### Definition of done (Phase 1)

- [ ] With `MICROSOFT_*` set, "Continue with Microsoft" appears and a real
      tenant user completes sign-in end-to-end locally
- [ ] `account` row exists with `providerId = "microsoft"`, a non-null
      `refreshToken`, and `scope` containing the mail/calendar scopes
- [ ] With `MICROSOFT_*` unset, the button is hidden and nothing throws
- [ ] Email/password still works; allow-list still rejects other domains
- [ ] `check-types` / `lint` / `test` pass; `HANDOFF.md` updated

---

## Phase 2 — Microsoft mail + calendar sync (full body, matched-only)

Goal: email/meetings with known CRM contacts appear on record timelines,
with bodies, synced from Outlook. Mirror `apps/api/src/google/` file-for-file
in a new `apps/api/src/microsoft/` module. Read the google file first, then
write the microsoft twin.

### Files to create (template → new file)

- `google.constants.ts` → `microsoft.constants.ts`:
  `MICROSOFT_PROVIDER_ID = "microsoft"`,
  `SYNC_SOURCES = ["outlook", "outlook-calendar"]`,
  `SCOPE_FOR_SOURCE = { outlook: MS_MAIL_SCOPE, "outlook-calendar": MS_CALENDAR_SCOPE }`.
- `google-token.service.ts` → `microsoft-token.service.ts`: identical logic;
  `auth.api.getAccessToken({ providerId: "microsoft", userId })`; outcomes
  `ok | not-connected | needs-reconnect`, never throw.
- `google-api.client.ts` → `graph-api.client.ts`: fetch wrapper for
  `https://graph.microsoft.com/v1.0`; map status codes: 401 → needs-reconnect,
  410/`SyncStateNotFound` → cursor reset, 429 → honor `Retry-After`.
- `gmail.client.ts` → `outlook-mail.client.ts`:
  - Delta: `GET /me/mailFolders/inbox/messages/delta` with
    `$select=id,internetMessageId,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,body,conversationId,internetMessageHeaders`.
  - Persist the returned `@odata.deltaLink` as the cursor
    (`MailboxSync.cursor`, source `"outlook"`); follow `@odata.nextLink`
    pages within a tick.
- `calendar.client.ts` → `outlook-calendar.client.ts`:
  `GET /me/calendarView/delta?startDateTime=<now>&endDateTime=<now+6mo>`;
  cursor = deltaLink, source `"outlook-calendar"`.
- `mime.ts` → `outlook-message.ts`: Graph returns parsed JSON (no MIME
  decoding needed). Extract: RFC id from `internetMessageId`; thread root
  from `internetMessageHeaders` (`References` / `In-Reply-To`) exactly like
  `mime.ts` does; plain-text body from `body.content` (strip HTML if
  `body.contentType === "html"`; reuse the quote-stripping logic from
  `mime.ts`).
- `google-match.service.ts` → `microsoft-match.service.ts`: copy nearly
  verbatim — the participant→contact/company logic is provider-agnostic.
  Reuse `participants.ts` AS-IS (import it, do not copy).
- `gmail-sync.service.ts` → `outlook-mail-sync.service.ts`: same structure:
  forward-only first pass (record cursor, import NOTHING), incremental pass
  builds `EmailThread` / `EmailMessage` (set `outlookMessageId`) / one
  projected `Activity` per thread; the same two-way-engagement gate;
  dedupe on unique `rfcMessageId`. Unmatched threads: DO NOT store bodies —
  hand participants to Phase 4's screening harvest (see below; in Phase 2,
  just drop them like Google does).
- `calendar-sync.service.ts` → `outlook-calendar-sync.service.ts`: key events
  by `(iCalUid, originalStartTime)` (Graph field `iCalUId`); set
  `outlookEventId`; attendees → `CalendarAttendee`.
- `google-sync.service.ts` → `microsoft-sync.service.ts`: orchestrator,
  60s tick budget, per-user runs.
- `sync.controller.ts`: add `GET|POST /internal/sync/microsoft` (same
  `CRON_SECRET` bearer guard) calling `MicrosoftSyncService.runDue()`.
- `google-connection.service.ts` → `microsoft-connection.service.ts`:
  reconcile `MailboxSync` rows from `account.scope` on connect; settings
  status; revoke (token revocation for Microsoft: delete stored tokens; there
  is no simple public revoke endpoint — document this in code).
- `google.router.ts` → `microsoft.router.ts` (alias `microsoft`): `status`,
  `syncNow`, `thread`, `event` procedures mirroring `google.*`. Then run
  `bun run --filter=api trpc:generate` and commit `src/generated/server.ts`.
- `conversation.service.ts`: generalize or mirror so timeline expansion can
  serve Microsoft threads (deep link:
  `https://outlook.office.com/mail/deeplink/read/{outlookMessageId}`).
- `microsoft.module.ts`: wire everything; register in `app.module.ts`.
- Cron registration: mirror the google entry in `apps/api/scripts/build-func.mjs`
  (`*/5 * * * *` → `/internal/sync/microsoft`).

### Front end

- The timeline already renders `Activity` rows of type EMAIL/MEETING. Wire the
  expand action for Microsoft-sourced threads to `microsoft.thread` /
  `microsoft.event` (find where `google.thread` is called and branch on which
  provider id field is set on the message).
- Settings page: mirror the Google connection card for Microsoft
  (connect status, sync now, auto-create toggles) — copy the component that
  uses `google.status`. **Done:** Settings prefers the full tRPC-backed
  `MicrosoftConnection` when `MICROSOFT_*` is set
  (`apps/app/app/(app)/settings/microsoft-connection.tsx`).

### Definition of done (Phase 2)

- [x] With a connected Microsoft account and `CRON_SECRET` set:
      `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3001/internal/sync/microsoft`
      returns a run summary and does not error
- [x] First run imports zero messages (forward-only) and records a cursor
- [x] Send a NEW email to/from an address that exists as a CRM contact, run
      sync again: the thread appears on that contact's timeline; expanding it
      shows the body
- [ ] An email with a stranger (not in CRM) creates NO rows
      (bodies still not stored; Phase 4 harvests metadata into Screening)
- [x] A calendar event with a known contact appears as a MEETING activity
- [x] `check-types` / `lint` / `test` pass; generated `server.ts` committed;
      `HANDOFF.md` updated

---

## Phase 3 — Backfill when a contact is added

Goal: adding a contact you already email retroactively imports recent history
with that address (and only that address).

### Design

- New model in `packages/db/prisma/schema.prisma`:

```prisma
model EmailBackfill {
  id            String    @id @default(cuid())
  address       String
  requestedById String?
  status        String    @default("PENDING") // PENDING | RUNNING | DONE | FAILED
  error         String?
  createdAt     DateTime  @default(now())
  finishedAt    DateTime?
  @@unique([address])
  @@map("emailBackfill")
}
```

- Enqueue: in `apps/api/src/contacts/contacts.service.ts`, after `create()`
  (and after `update()` when `email` is set or changed), upsert an
  `EmailBackfill` row for the address. Mechanical — no agent involvement.
- Worker: at the end of each Microsoft sync tick (`microsoft-sync.service.ts`),
  process up to N pending backfills within the remaining budget:
  - For each mailbox-connected user: Graph
    `GET /me/messages?$search="participants:<address>"` (quotes required),
    page cap 5 pages x 50 messages, discard anything older than 180 days
    (config constant, not an env var).
  - Feed results through the SAME store path as Phase 2 (match, thread,
    message, activity). `rfcMessageId` unique makes this idempotent.
  - Mark DONE/FAILED with error text.

### Definition of done (Phase 3)

- [x] Create a contact whose address you exchanged mail with BEFORE Phase 2's
      baseline: after the next sync tick, those recent threads appear on the
      new contact's timeline
- [x] Running the same backfill twice creates no duplicates
- [x] `check-types` / `lint` / `test` pass; `HANDOFF.md` updated

---

## Phase 4 — Screening Room (approve unknown contacts)

Goal: frequent external correspondents who are NOT in the CRM surface in a
review queue; approving creates the contact (and triggers backfill), rejecting
suppresses them.

### Design

- New model (metadata only — never bodies):

```prisma
model PendingContact {
  id            String    @id @default(cuid())
  email         String    @unique
  displayName   String?
  domain        String
  direction     String    // INBOUND | OUTBOUND (first seen)
  sampleSubject String?
  messageCount  Int       @default(1)
  firstSeenAt   DateTime  @default(now())
  lastSeenAt    DateTime  @default(now())
  status        String    @default("PENDING") // PENDING | APPROVED | REJECTED
  decidedById   String?
  decidedAt     DateTime?
  @@index([status, lastSeenAt])
  @@map("pendingContact")
}
```

- Harvest INSIDE the Phase 2 sync (no extra Graph pass): where
  `outlook-mail-sync.service.ts` drops an unmatched thread, first extract its
  external participants (reuse `participants.ts`), filter out
  `SuppressedDomain` rows and existing `Contact.email`s, and upsert
  `PendingContact` (bump `messageCount` / `lastSeenAt`).
- API: new `screening.router.ts` (alias `screening`): `list` (PENDING, ranked
  by messageCount desc then lastSeenAt desc), `decide({ id, decision, createContact?: { firstName, lastName, companyId? } })`:
  - approve → create `Contact` (source `EMAIL`), enqueue `EmailBackfill`,
    call `AgentTriggerService.contactCreated(id, "approved in screening room")`,
    mark APPROVED.
  - reject → mark REJECTED; optional flag `suppressDomain` also inserts the
    domain into `SuppressedDomain`.
  - Regenerate + commit `server.ts`.
- UI: new route `apps/app/app/(app)/screening/page.tsx` — table of pending
  candidates (name/email/domain, count, last seen, sample subject) with
  Approve / Reject buttons. Use `packages/ui` table + button components and
  the existing list-page patterns (see `contacts/page.tsx`). Add it to the
  app icon rail (`apps/app/components/app-icon-rail.tsx`).

### Definition of done (Phase 4)

- [x] Mail from a stranger shows up in Screening (no thread/body stored)
- [x] Approve → contact exists (source EMAIL), backfill runs, agent identify
      task is enqueued, candidate disappears from the queue
- [x] Reject with suppress → domain in `SuppressedDomain`; future mail from it
      never reappears
- [x] `check-types` / `lint` / `test` pass; `HANDOFF.md` updated

---

## Phase 5 — Follow-ups / Sales Cockpit panel (per-rep)

Goal: the agent reads the rep's recent synced mail (~30+ messages) plus their
open deals and proposes follow-ups; accepted ones become real CRM tasks.

### Design

- New model:

```prisma
model FollowUpSuggestion {
  id         String    @id @default(cuid())
  userId     String    // the rep this belongs to
  contactId  String?
  companyId  String?
  dealId     String?
  kind       String    // commitment | reply-owed | deal-risk | next-step
  summary    String    // one sentence, imperative ("Send Acme the revised quote")
  quote      String?   // short cited excerpt (<= 300 chars), never a full body
  dueHint    DateTime?
  evidence   Json      // [{ threadId, messageId, sentAt }]
  status     String    @default("PROPOSED") // PROPOSED | ACCEPTED | DISMISSED | SNOOZED
  activityId String?   // the created TASK when accepted
  createdAt  DateTime  @default(now())
  decidedAt  DateTime?
  @@index([userId, status, createdAt])
  @@map("followUpSuggestion")
}
```

- Agent side (`apps/agent` — read the `eve` skill first):
  - New task kind `"followups"` handled like existing kinds: the API (or a
    small agent schedule) enqueues one `AgentTask` per mailbox-connected rep
    per day (dedupe: skip if an unfinished `followups` task exists for that
    user — same pattern as `AgentTriggerService.enqueue`).
  - New tool `apps/agent/agent/tools/propose_followups.ts`: input
    `{ userId }`; reads the rep's recent synced threads (via `@crm/db`, the
    same read patterns as `lib/crm.ts`) and their open deals (stage,
    `lastActivityAt`); writes `FollowUpSuggestion` rows. Dedupe before insert:
    skip if a PROPOSED suggestion with the same `(userId, dealId|contactId, kind)`
    already exists. Never invent evidence — every suggestion cites real
    message ids in `evidence`.
  - Detection targets: explicit commitments in the rep's own sent mail
    ("I'll send X by Friday"), inbound questions never answered (reply-owed),
    deals with `stageChangedAt` long ago and no recent activity (deal-risk),
    agreed next steps (next-step).
- API: new `followups.router.ts` (alias `followups`): `list` (mine, PROPOSED
  + SNOOZED due), `decide({ id, decision, dueAt? })`:
  - accept → create `Activity { type: TASK, subject: summary, dueAt: dueAt ?? dueHint ?? now+3d, contactId/companyId/dealId from suggestion, createdById: session user }`,
    store `activityId`, mark ACCEPTED.
  - dismiss → DISMISSED. snooze → SNOOZED with a new `dueHint`.
  - Regenerate + commit `server.ts`.
- UI: new route `apps/app/app/(app)/follow-ups/page.tsx`, three sections:
  1. Suggested follow-ups (PROPOSED — accept / snooze / dismiss; accepting
     optionally edits due date),
  2. My open tasks (`activities.myTasks`, overdue highlighted — this query
     already exists),
  3. My active deals at a glance (my open deals by stage with
     `lastActivityAt`; reuse deal-stage helpers from
     `apps/app/components/crm/deal-stage.tsx`).
  Add to the icon rail. Everything scoped to the signed-in rep.

**Done, with these deviations from the design above:**

- `AgentTask` gained an additive `userId String?` column (+ index) rather than
  overloading `contactId`. A per-rep sweep is about a rep, not a record, and
  the dispatcher's own attributes/preamble plumbing already branches on which
  id is set — `userId` is one more branch, not a new mechanism.
  `AgentTriggerService.followupsDue(userId, reason)` mirrors
  `contactCreated`/`meetingSoon`.
- The enqueue is an API cron (`apps/api/src/followups/`, route
  `GET|POST /internal/agent/followups`, `CRON_SECRET`-guarded like the sync
  routes, once daily at 13:00 UTC), not an agent-side schedule — it needs to
  read `MailboxSync` for "which reps are mailbox-connected", which is API-side
  data reached the same way the Microsoft/Google cron routes already do.
- Two tools, not one: `read_rep_followup_context` (free read — recent
  `syncedByUserId` mail + open deals, via `apps/agent/agent/lib/followups.ts`)
  and `propose_followups` (writes exactly one suggestion per call, mirroring
  `record_fact`'s one-claim-at-a-time shape). `propose_followups` verifies
  every cited `messageId` actually exists before writing — a suggestion citing
  a message nobody can find fails there rather than reaching a rep's screen.
- UI panel is `Card`/`CardPanel`/`SimpleTable` (the pattern the overview
  dashboard already uses for two same-height side-by-side lists), not
  `DataTable` — same reasoning as the Screening Room table.

### Priority prefs (Phase 5 add-on)

Goal: each rep shapes what the Follow-ups page calls out first, via three
fixed selects — not open chat. Filters first; the daily sweep can read the
same prefs. A future on-page agent ask (mail/Graph context) is planned, not
built here.

**Three questions (select-only):**

1. **What should float first?** (`floatFirst`)
   - `commitments` — commitments I made
   - `replies` — replies I owe
   - `deal-risk` — at-risk / stale deals
   - `balanced` — default mix (due date, then newest)
2. **How far back matters?** (`lookback`)
   - `7d` / `30d` (default) / `90d`
3. **Whose work?** (`scope`)
   - `owned` — my owned deals + my mail (default)
   - `shared` — also deals I have activity on (no membership table)
   - `mail` — mail-driven kinds only (`commitment` / `reply-owed` /
     `next-step`); deals lane stays secondary

**Storage:** `FollowUpPreference` (one row per `userId`, upserted). Defaults
apply when no row exists. Shared constants in `packages/db` so API + agent
agree.

**How they apply (v1 — no new agent chat UI):**

- `followups.list` filters + reorders suggestions by prefs.
- Deals lane on `/follow-ups` respects `scope` (`owned` vs `shared`;
  `mail` keeps owned deals but suggestions drop `deal-risk`).
- Daily sweep: `followupsPreamble` and `repFollowupContext` read prefs —
  lookback trims mail window; float/scope bias what to propose. Still
  mechanical filters + prompt text, not a free-form agent on the page.

**API:** `followups.prefs` (query) + `followups.updatePrefs` (mutation).
**UI:** three selects above the suggestions table on `/follow-ups`.

**Later (not this slice):** constrained ask on `/follow-ups` that already
knows prefs + synced mail (and optionally Graph). Do not build until asked.

### Definition of done (Phase 5)

- [x] With synced mail present, the daily task produces suggestions with real
      cited evidence (spot-check: each cites message ids that exist)
      (2026-08-02: 1 PROPOSED `reply-owed`; evidence message id present in DB)
- [x] Accept creates a TASK visible on the record timeline AND in "My open
      tasks"; dismiss/snooze behave; nothing duplicates on the next run
      (2026-08-02 human: accept → TASK created → task cleared)
- [x] A rep sees only their own suggestions/tasks/deals
      (2026-08-02 human smoke on signed-in rep `/follow-ups`)
- [x] Priority prefs: changing the three selects reshapes list order/filter
      without an agent round-trip; prefs persist per rep
      (UI + API shipped; human marked Phase 5 smoke complete)
- [x] `check-types` / `lint` / `test` pass; `HANDOFF.md` updated

---

## Phase 6 — Optional extras (only when asked)

**Status (2026-08-02): deferred by human — do not start unless re-asked.**

- Outlook contacts import via Graph `/me/contacts` (`Contacts.Read`), routed
  through the Screening Room rather than direct creation.
  *(Deferred: Screening-from-mail covers most cases.)*
- Meeting prep: on calendar sync, call `AgentTriggerService.meetingSoon()`
  for upcoming external meetings (mirror the Google calendar-sync hook).
  *(Already done in Phase 2 —
  `outlook-calendar-sync.service.ts` `prepareForMeeting`.)*
- Teams: post a rep's daily follow-up digest to a channel (incoming webhook
  is the simplest start).
  *(Deferred: not needed yet.)*

## Phase 7 — Sage CRM interface layer (separate track, own plan)

Connector syncing companies/contacts/deals so this app acts as the agentic
front-end over Sage. The dedicated plan is [docs/plans/sage-crm-sync.md](sage-crm-sync.md).
**Status (2026-08-02):** company/contact pull (Mobile Mark test slice) + Sage-ID
UI are landed; Deal forecasting columns + opportunity import are next. Follow
that doc + `HANDOFF.md`, not this stub.

---

## Security posture

- Single-tenant Entra app; delegated, read-only scopes (`Mail.Read`,
  `Calendars.Read`); admin consent.
- Bodies at rest but scoped: only threads matched to known contacts/companies
  are stored; backfill targets a single address; `SuppressedDomain` excludes
  vendors/newsletters; Screening Room stores metadata only.
- `FollowUpSuggestion.quote` is capped (<= 300 chars) — never a full body.
- Graph calls run in the API app runtime. The agent sandbox keeps deny-all
  egress and never receives `DATABASE_URL` (see `docs/agent.md`).
- `EmailMessage.body` is already never logged and never included in list
  payloads — keep it that way in the Microsoft module.

## Open tradeoffs (decide at build time, record the decision in HANDOFF.md)

- Backfill window (default 180 days) and page cap — cost vs completeness.
- Follow-up cadence: daily per-rep task vs after every sync (daily
  recommended; avoids noise).
- Whether "active deals at a glance" stays in the Follow-ups panel or becomes
  a dashboard tab.
