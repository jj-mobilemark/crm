# Local setup — tracking

Status log for the local install of this CRM on macOS. Update this as the
environment changes so anyone (human or agent) can see the current state.

## Environment

- **Repo**: cloned from https://github.com/trycompai/crm into `MM-CRM/`
- **OS**: macOS (darwin)
- **Node**: v24 (repo requires `>=22`)
- **Bun**: 1.3.x installed via the official installer to `~/.bun`
  (`~/.bun/bin` added to `PATH` in `~/.zshrc`)
- **Docker**: Docker Desktop; Postgres 17 in container `crm-postgres` on `:5432`

## Setup steps completed

- [x] `git clone` the repo into the folder
- [x] Installed Bun (official installer)
- [x] Started Docker Desktop
- [x] Created `.env` from `.env.example`
- [x] Generated `BETTER_AUTH_SECRET` (`openssl rand -base64 32`)
- [x] `bun install`
- [x] `docker compose up -d` (Postgres)
- [x] `bun run db:deploy` — all migrations applied
- [x] `bun run db:seed` — demo data (15 companies, 45 contacts, 23 deals, 162 activities)
- [x] Added `.cursor/rules/` and this tracking doc

## Signing in (email + password)

Auth runs on **email + password** locally (see "Auth changes" below); Google
OAuth is optional. Microsoft SSO is enabled when `MICROSOFT_*` are set. The
required `.env` values are:

- [x] `BETTER_AUTH_SECRET` — generated
- [x] `ALLOWED_SIGN_IN` — set to `mobilemark.com` (the whole authorisation
  model: only addresses on this domain may sign in; public registration
  is disabled — see below)
- [x] Microsoft Entra (`MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` /
  `MICROSOFT_TENANT_ID`) — set for local Microsoft sign-in
- Google OAuth (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) — left empty; the
  Google button is hidden until they are set.

### First run

```bash
bun run dev        # app on http://localhost:3000, api on http://localhost:3001
```

1. Open http://localhost:3000 → you land on `/sign-in`.
2. Prefer **Continue with Microsoft** (Entra SSO), or email/password for an
   **existing** user. Public “Create account” is off
   (`emailAndPassword.disableSignUp` + OAuth `disableImplicitSignUp`) so
   prod/local CRM data cannot grow new accounts from the welcome page.
3. To bootstrap the first local user: insert a row in `user` + credential
   `account` (or temporarily set `disableSignUp: false` / clear
   `disableImplicitSignUp`, create one account, then lock again).
4. Next time, use Microsoft again, or the same email + password.

An email whose domain is not on `ALLOWED_SIGN_IN` is still refused if signup
is ever re-enabled (HTTP 403).

### Microsoft Entra redirect URI

Web redirect URI in the Entra app registration:

`http://localhost:3001/api/auth/callback/microsoft`

### Settings

With `MICROSOFT_*` set, Settings shows a **Microsoft 365** connection card
driven by `microsoft.status` (Check now, Meetings/Email auto-create toggles,
purge, revoke). Set `CRON_SECRET` in root `.env` so
`POST /internal/sync/microsoft` and the five-minute cron can run.

### Turning Google sign-in back on later

Fill in a real OAuth client and restart; the Google button reappears
automatically.

1. Google Cloud console → **Credentials** → **Create credentials** →
   **OAuth client ID** → **Web application**.
2. Authorised redirect URI: `http://localhost:3001/api/auth/callback/google`.
3. Enable the **Gmail API** and **Calendar API**.
4. Put the client ID/secret in `.env`.

## Auth changes from upstream

To run without a Google account, this install differs from upstream `trycompai/crm`:

- `packages/auth/src/auth.ts` — `emailAndPassword.enabled: true` with
  `disableSignUp: true` (existing accounts only); Microsoft/Google use
  `disableImplicitSignUp: true`.
- `apps/api/src/config/env.validation.ts` — `GOOGLE_CLIENT_ID` /
  `GOOGLE_CLIENT_SECRET` are now optional (were required).
- `apps/app/app/(app)/layout.tsx` — gate relaxed from `requireGoogleAccess()`
  to `requireSession()`, since the Gmail/Calendar scope gate is Google-only and
  would lock out email/password users.
- `apps/app/app/(auth)/sign-in/` — `credentials-form.tsx` is sign-in only
  (no register mode); the Google/Microsoft buttons only appear when configured.

The `ALLOWED_SIGN_IN` allow-list still governs who may sign in when signup is
enabled; with signup locked, only pre-existing users get in.

## Agent harness config (Cursor / Claude Code / Codex)

The repo shipped Claude Code / Codex config. It now works across harnesses:

- **Skills** — canonical source is `.agents/skills/` (tracked by
  `skills-lock.json`). Each harness symlinks into it, so there's one copy:
  - `.cursor/skills/`  → Cursor (auto-discovered)
  - `.claude/skills/`  → Claude Code
  - Edit skills only in `.agents/skills/`; never in the symlink dirs.
- **Instructions** — `AGENTS.md` at the root is the shared entry point. Cursor
  reads it natively; `CLAUDE.md` just re-exports it (`@AGENTS.md`).
- **Cursor rules** — `.cursor/rules/*.mdc` add Cursor-native, always-on
  pointers to the architecture, local-dev commands, and the skills/docs above.

## Optional capabilities (all off by default)

Each key in `.env` unlocks one more thing the agent can do; the app runs fine
with none of them. See `.env.example` for the annotated list
(`PERPLEXITY_API_KEY`, `RAPIDAPI_KEY`, `CONTEXT_DEV_API_KEY`, `REDIS_URL`, …).

## Companies map (`/map`)

Nav item **Map** shows companies on a Leaflet map (city-level). Coordinates
come from Nominatim via a one-shot script — pins stay empty until you run it
after `db:deploy` (or after a Sage location backfill):

```bash
cd apps/api && bun run scripts/geocode-companies.ts --dry-run
cd apps/api && bun run scripts/geocode-companies.ts
```

Details: `docs/plans/companies-map.md`.
