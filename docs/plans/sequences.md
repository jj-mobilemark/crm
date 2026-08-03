# Email sequences

Multi-step outbound email cadences. Reps build a sequence, enroll contacts, and
the API sends from each rep's own Outlook mailbox via Microsoft Graph on a
cron-driven tick.

This is **mechanical** work in `apps/api` — intelligence stays in the agent.

## Status

**Implemented** (2026-08-03): schema, Graph `Mail.Send` client, sequences
module (CRUD + enroll + tick + tracking), `/sequences` UI, nav entry, cron.

## Prerequisites (manual Entra step)

1. Azure portal → Entra ID → App registrations → your `MM-CRM` app.
2. API permissions → Microsoft Graph → Delegated → add **`Mail.Send`**.
3. **Grant admin consent** for the tenant.
4. Each rep must re-consent (Settings reconnect, or `/grant-access` if sync
   scopes are also missing). New sign-ins request `Mail.Send` automatically
   via `MS_ALL_SCOPES` in `packages/auth`.

Without `Mail.Send`, reps can still **view and build** sequences; enroll /
activate-send is blocked until the grant includes send.

## Architecture

| Piece | Role |
| --- | --- |
| `EmailSequence` / `SequenceStep` | Template: name, steps, delays, timezone, send window |
| `SequenceEnrollment` | One contact in one sequence; `nextRunAt` + lease |
| `SequenceStepRun` | Per-send log + tracking token |
| `SequenceUnsubscribe` | Global email suppression |
| `GET /internal/sequences/tick` | Vercel Cron every 2 minutes (`CRON_SECRET`) |
| `POST /me/sendMail` | Graph send via `OutlookSendClient` |
| `/t/open/:token`, `/t/click/:token`, `/u/:token` | Open / click / unsubscribe |

Sending identity: **per-rep delegated** (`senderUserId` = enrolling rep).

Reply auto-stop: tick looks for an INBOUND `EmailMessage` from the contact
since enrollment (mail sync must be running).

## Key files

- `packages/auth/src/scopes.ts` — `MS_MAIL_SEND_SCOPE`, `hasMsSendScopes`
- `apps/api/src/microsoft/outlook-send.client.ts` — Graph send
- `apps/api/src/sequences/` — module, service, tick, controller, router
- `apps/app/app/(app)/sequences/` — UI
- `packages/db/prisma/migrations/20260803100000_add_email_sequences/`

## Env

- Existing: `MICROSOFT_*`, `CRON_SECRET`, `API_URL`, `APP_URL`
- Optional: `APP_PUBLIC_URL` — absolute origin for tracking / unsubscribe
  links inside email (defaults to `API_URL`)

## Local smoke test

1. Confirm Entra has `Mail.Send` + admin consent; reconnect Microsoft.
2. Open `/sequences` → New sequence → Activate.
3. Enroll a contact that has an email.
4. Trigger the tick:
   ```bash
   curl -X POST -H "Authorization: Bearer $(grep '^CRON_SECRET=' .env | cut -d= -f2- | tr -d \"\\'\")" \
     http://localhost:3001/internal/sequences/tick
   ```
5. Check Sent Items in Outlook and the contact timeline.

## Deliberately out of scope (for now)

- Bounce / NDR auto-stop
- Per-mailbox daily send caps / jitter
- Deal-stage auto-enroll triggers
- A/B subjects / agent-written body copy
- Google Gmail send path
