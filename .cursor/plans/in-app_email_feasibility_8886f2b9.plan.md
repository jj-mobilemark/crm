---
name: In-app email feasibility
overview: In-app Outlook compose/send is moderate effort (roughly 1–3 days for a solid MVP), not a greenfield project. Send, tokens, and timeline logging already exist for sequences; the missing piece is a compose UI plus a user-facing send mutation.
todos: []
isProject: false
---

# In-app email draft/send — feasibility

**Short answer:** Yes, it is possible and worth pursuing for a focused MVP. You already send real Outlook mail from the CRM (sequences + daily task push). Replacing `mailto:` with an in-app compose sheet that calls the same Graph path is mostly UI + one mutation, not a new integration.

## What you have today

| Piece | Status |
| --- | --- |
| Graph `POST /me/sendMail` | Done — [`outlook-send.client.ts`](apps/api/src/microsoft/outlook-send.client.ts) |
| Per-rep delegated token + `Mail.Send` check | Done — [`microsoft-token.service.ts`](apps/api/src/microsoft/microsoft-token.service.ts) `accessTokenForSend` |
| OAuth scope `Mail.Send` | Done — [`packages/auth/src/scopes.ts`](packages/auth/src/scopes.ts); grant-access asks for it |
| Timeline `ActivityType.EMAIL` on send | Done for sequences — [`sequence-tick.service.ts`](apps/api/src/sequences/sequence-tick.service.ts) ~367–385 |
| Outlook → `EmailThread` / `EmailMessage` sync | Done — Sent Items eventually land on the contact/company timeline |
| Click email → compose | **Not done** — [`contact-sheet.tsx`](apps/app/components/crm/record-sheet/contact-sheet.tsx) uses `mailto:` |
| Timeline “EMAIL” type | Manual log only (“What was said?”) — does **not** send |

So today: automated sequence mail goes through Outlook; clicking a contact email still opens the OS mail client.

```mermaid
flowchart LR
  click[Click contact email]
  today[mailto opens OS mail]
  mvp[CRM compose sheet]
  graph[Graph me/sendMail]
  outlook[Outlook Sent Items]
  sync[Mail sync]
  act[Activity on timeline]

  click --> today
  click -.-> mvp
  mvp --> graph
  graph --> outlook
  outlook --> sync
  sync --> act
  mvp --> act
```

## Two different products (difficulty differs)

### A. Compose + Send inside the CRM (what you described)

User clicks email → sheet with To (prefilled) / Subject / Body → Send → mail goes from their Outlook mailbox → activity on the timeline.

**Difficulty: medium-easy.** Backend path is already proven. Main work is UI and wiring.

Rough MVP scope:

1. **UI** — Dialog/sheet from contact (and company) email clicks; guard when `Mail.Send` missing (reuse the sequences “reconnect Microsoft” pattern).
2. **API** — tRPC mutation e.g. `microsoft.sendMail` / `emails.send` calling existing `OutlookSendClient` + `accessTokenForSend`.
3. **Activity** — On success, create `ActivityType.EMAIL` (same pattern as sequences). Sync will also import the Sent Item later; either stamp immediately (best UX) or accept sync lag.
4. **Replace** `mailto:` in contact sheet (only call sites found under `apps/app`).

Optional later (each adds real work): CC/BCC, attachments, rich HTML editor, reply-to-thread (`inReplyTo` already exists on the send client), templates/merge fields from sequences.

**Ops caveat (same as sequences):** Entra must have delegated `Mail.Send` + admin consent; each rep must have reconnected. If that is not live in prod yet, in-app send and sequences share that blocker.

### B. True Outlook draft (sits in Drafts, edit in Outlook)

Create a Graph draft (`POST /me/messages` with `isDraft`), optionally open Outlook’s deep link, user finishes/sends in Outlook.

**Difficulty: harder.** Needs `Mail.ReadWrite` (new scope → Entra change → every user reconnects). Draft ↔ CRM sync and “did they send?” tracking are messier. Usually not worth it if the goal is “send from here and log it.”

Recommendation: pursue **A**, not B.

## Effort ballpark

| Scope | Effort | Notes |
| --- | --- | --- |
| MVP: To + Subject + plain/HTML body + Send + Activity | ~1–2 days | Reuses send client + canSend pattern |
| Polished: CC, reply-in-thread, better editor, company mailto too | ~3–5 days | Still no new Graph product |
| Outlook Drafts folder + deep link | 1+ week + Entra | Extra scope and UX edge cases |

## Worth pursuing?

**Yes**, if reps already connect Microsoft and you want outreach to stay in the CRM without bouncing to Outlook/Apple Mail.

Reasons it is a good bet:

- Send plumbing is battle-tested for sequences.
- Activity + mail sync models already exist.
- Click surface is small (`mailto` only in the contact sheet today).
- Aligns with “CRM as the work surface over Sage/Outlook.”

Reasons to wait:

- If Entra `Mail.Send` is still not consented, fix that first (unlocks sequences too).
- If the real need is “open Outlook with a draft,” a deep link / `mailto` may be enough and cheaper.

## Suggested MVP (if you greenlight later)

1. `emails.send` (or `microsoft.sendMail`) mutation: to, subject, htmlBody, contactId/companyId → `OutlookSendClient` → stamp `Activity`.
2. Compose sheet opened from contact email click when connected; fallback to `mailto` or a reconnect banner when not.
3. Keep timeline composer EMAIL as **manual log** (past emails); do not conflate with Send.

No schema change required for MVP. Attachments and draft-folder sync can stay out of v1.
