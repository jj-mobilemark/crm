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

- **Runs locally**: Bun 1.3.12 monorepo; Postgres via `docker compose up -d`;
  `bun run dev` serves app on :3000 and API on :3001. Setup details in
  `docs/local-setup.md`.
- **Auth**: email + password (fallback), allow-list
  `ALLOWED_SIGN_IN=mobilemark.com`. **Microsoft SSO works end-to-end** for
  `jjohnson@mobilemark.com`: `account` row `providerId=microsoft`,
  `refreshToken` present, scope includes `Mail.Read` + `Calendars.Read`
  (short names). Google OAuth still optional / unconfigured.
  `MICROSOFT_*` set in root `.env` (secret never recorded here).
- **Settings**: full Microsoft 365 card via `microsoft.status` (Check now,
  auto-create, purge, revoke). Google card only when Google is configured and
  Microsoft is not.
- **Active plan**: `docs/plans/m365-expansion.md` (Phases 0–7).
- **Phase 0**: DONE. **Phase 1**: DONE. **Phase 2**: code DONE — needs human
  smoke test (cron + real mail/meeting).
- **Next step**: Human smoke-test Phase 2 Definition of Done, then **Phase 3**
  (backfill on contact add). See newest work-log entry.

## Work log (newest first)

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
