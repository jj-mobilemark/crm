---
name: Microsoft 365 Expansion
overview: A phased plan to replace Google with Microsoft 365 (Entra SSO), add a full-body Outlook mail/calendar sync whose visibility is gated to people already in the CRM (with targeted backfill when a contact is added), a Screening Room for approving unknown contacts, and a per-rep Follow-ups / Sales Cockpit panel where the agent turns recent email into actionable, deal-aware tasks.
todos:
  - id: phase0
    content: "Phase 0: Entra app registration (manual) + additive schema prep (outlookMessageId / outlookEventId)"
    status: pending
  - id: phase1
    content: "Phase 1: Microsoft SSO via Better Auth (replace Google), scopes, env vars, sign-in UI"
    status: pending
  - id: phase2
    content: "Phase 2: Microsoft mail + calendar full-body sync, matched-only (mirror apps/api/src/google/)"
    status: pending
  - id: phase3
    content: "Phase 3: EmailBackfill model + targeted Graph backfill when a contact is added"
    status: pending
  - id: phase4
    content: "Phase 4: Screening Room - PendingContact harvest in sync, screening router, approve/reject UI"
    status: pending
  - id: phase5
    content: "Phase 5: Follow-ups panel - FollowUpSuggestion model, propose_followups agent tool, followups router, per-rep UI"
    status: pending
  - id: phase6
    content: "Phase 6 (optional): Outlook contacts import, meeting-prep trigger, Teams digest"
    status: pending
  - id: phase7
    content: "Phase 7 (separate track): Sage CRM bidirectional connector / interface layer"
    status: pending
isProject: false
---

# Microsoft 365 Expansion Plan

**The canonical, execution-ready copy of this plan lives IN THE REPO at
[docs/plans/m365-expansion.md](docs/plans/m365-expansion.md).** It was written
for lower-skill executing agents: every phase has exact file paths, concrete
steps, a Definition of Done checklist, and verification commands. Edit that
file, not this one.

## Companion process (also set up in the repo)

- `HANDOFF.md` at the repo root is the running handoff log: what was
  completed, how and why, deviations from this plan, and what is next.
  `AGENTS.md` instructs every agent to read it before starting and update it
  before stopping.

## Decisions locked with the user

- Microsoft 365 replaces Google (email/password stays as fallback).
- Full-body mail sync, matched-only: bodies stored only for threads that
  resolve to a known CRM Contact/Company; unmatched mail is never stored.
- Targeted Graph backfill when a contact is added (recent history appears
  retroactively, only for that address).
- Agent-detected follow-ups are suggestions; accepting creates a real
  `Activity` TASK linked to the contact/deal.
- The Follow-ups / Sales Cockpit panel is per-rep.

## Phase summary

- Phase 0 — Entra app registration (manual portal steps documented) +
  additive-only schema prep (`outlookMessageId`, `outlookEventId`; no risky
  renames).
- Phase 1 — Microsoft SSO via Better Auth (`socialProviders.microsoft`),
  Graph scopes in `packages/auth/src/scopes.ts`, `MICROSOFT_*` env vars,
  sign-in + grant-access UI.
- Phase 2 — `apps/api/src/microsoft/` module mirroring `apps/api/src/google/`
  file-for-file: Graph delta sync for mail + calendar, forward-only baseline,
  matched-only storage, timeline wiring, settings card, cron route.
- Phase 3 — `EmailBackfill` model; enqueue on contact create/email change;
  worker runs inside the sync tick via Graph `$search="participants:<addr>"`,
  idempotent via unique `rfcMessageId`.
- Phase 4 — Screening Room: `PendingContact` harvested from unmatched
  participants during sync (metadata only), `screening` tRPC router,
  approve (create contact + backfill + agent identify) / reject (suppress).
- Phase 5 — Follow-ups panel: `FollowUpSuggestion` model, `propose_followups`
  agent tool on a daily per-rep task, `followups` router, three-lane per-rep
  UI (suggestions / my open tasks / active deals).
- Phase 6 — optional: Outlook contacts import, meeting-prep trigger, Teams.
- Phase 7 — separate track: Sage CRM connector.

## Security posture

Single-tenant Entra app; delegated read-only scopes; bodies at rest but scoped
to CRM-matched threads; Screening Room and follow-up quotes are metadata /
capped excerpts; agent sandbox keeps deny-all egress and no `DATABASE_URL`.
