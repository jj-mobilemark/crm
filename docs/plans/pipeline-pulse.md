# Pipeline pulse — deal change feed on the overview

Sales-manager pulse on `/` (overview): what moved recently on deals, biggest
movers, and stuck deals — plus a pipeline-scoped AI chat.

Mechanical data only in Nest/DB. Intelligence stays in the agent.

## Status

| Piece | Status |
| --- | --- |
| `DealFieldChange` schema + writers (app + Sage pull) | **DONE** (2026-08-03) |
| Overview pulse UI (strip + movers + feed + stuck) | **DONE** (2026-08-03) |
| Pipeline agent session on overview | **DONE** (2026-08-03) |
| Advanced reports (`read_pipeline_report`) | **DONE** (2026-08-03) |

## Locked decisions (2026-08-03)

1. **Audience**: Everyone tab is the manager view; Me still scopes the same UI.
2. **Field priority** (won/lost first): won/lost → certainty % → stage → amount →
   expected close → owner / priority. Also log `sageStage` from pull.
3. **Sources**: both app UI writes and Sage pull diffs. Label `app` / `sage`.
   Push echo (`isPushEcho`) must **not** double-log.
4. **UI**: pulse strip + biggest movers + recent feed + stuck (14d+).
5. **Pulse window**: fixed **last 7 days** (independent of closed-won range).
6. **Agent**: fourth kind `pipeline` on overview after pulse UI.
7. **Reports** (2026-08-03): pulse stays the 7-day change log; month / stage /
   closing / closed questions use `read_pipeline_report` (shared
   `loadPipelineReport` in `@crm/db`). Prefer unweighted `amount`; weighted is
   secondary. Deal list capped at 40; aggregates stay full-accuracy.

## Architecture

| Piece | Role |
| --- | --- |
| `DealFieldChange` | Append-only field diffs (`from`/`to` strings, `source`, optional actor) |
| `DealChangeRecorder` | Diff before/after snapshots; `createMany` rows. Global via `CrmModule` |
| Deals UI path | `DealsService.update` / `setStage` → recorder (`source: app`) |
| Sage pull | `SagePullService.upsertDeal` → recorder (`source: sage`) when not echo |
| `loadPipelinePulse` (`@crm/db`) | Shared query for Nest summary + agent tool |
| `loadPipelineReport` (`@crm/db`) | Shared month/stage reports for the agent |
| `dashboard.summary.pulse` | Counts, movers, recent feed, stuck — last 7 days, Me/Everyone |
| `pipeline` AgentRecordKind | Overview chat; id = `me` \| `everyone`; filing `pipelineScope` |
| `read_pipeline_pulse` | Agent tool — same shape as dashboard pulse |
| `read_pipeline_report` | Agent tool — open by stage, forecast by close month, closing / closed in month |

Tracked fields: `stage`, `probability`, `amount`, `expectedCloseDate`,
`ownerId`, `priority`, `sageStage`.

Won/lost are **stage** rows whose `toValue` is `CLOSED_WON` / `CLOSED_LOST`
(counted separately in the pulse strip).

Stuck: open deals whose last stage move / tracked change is older than **14
days** (fallback `stageChangedAt` when no change-log row exists yet).

## Key files

- `packages/db/prisma/schema.prisma` — `DealFieldChange`, `pipelineScope`
- `packages/db/src/pipeline-pulse.ts` — shared pulse query
- `packages/db/src/pipeline-report.ts` — shared month/stage reports for the agent
- `packages/db/prisma/migrations/20260803130000_add_deal_field_change/`
- `packages/db/prisma/migrations/20260803140000_add_pipeline_scope/`
- `apps/api/src/crm/deal-change.service.ts` — recorder
- `apps/api/src/deals/deals.service.ts` — app writes
- `apps/api/src/sage/sage-pull.service.ts` — Sage diffs
- `apps/api/src/dashboard/dashboard.service.ts` — `pulse` on summary
- `apps/app/app/(app)/pipeline-pulse.tsx` — UI
- `apps/app/app/(app)/dashboard-summary.tsx` — mounts pulse + agent panel
- `apps/app/lib/agent-record.ts` — `pipeline` kind
- `apps/app/components/crm/agent-panel.tsx` — `PipelineAgentPanel`
- `apps/agent/agent/tools/read_pipeline_pulse.ts`
- `apps/agent/agent/tools/read_pipeline_report.ts` — month / stage / closing / closed
- `apps/agent/agent/lib/preamble.ts` — `pipelinePreamble`

## Local smoke

1. Migrate: `bun run db:migrate` in `packages/db` (or deploy the migrations).
2. Restart API (+ agent if running). Edit a deal certainty or stage in the UI →
   row in `dealFieldChange` with `source = app`.
3. Run a Sage incremental pull that changes an opp → `source = sage` rows;
   push-echo updates should add none.
4. Overview (Everyone): pulse strip / movers / feed / stuck populate after
   there is data in the 7-day window.
5. Overview agent panel: “What moved this week?” → starts with
   `read_pipeline_pulse`; Me/Everyone follows the overview toggle.
6. Overview agent: “What's closing this month?” or “pipeline for August 2026”
   → `read_pipeline_report` with `closing_in_month` or
   `forecast_by_close_month` and `month=YYYY-MM`; real deal rows, no invented
   totals. Redeploy Railway `agent` before expecting this in prod.

---

## Agent handoff (DONE 2026-08-03)

Pulse UI and pipeline agent both shipped. Kept below as the original brief.

### Goal

Add an AI panel on the overview so a sales manager can ask pipeline questions
(“What moved this week?”, “Who’s stuck?”, “What's closing this month?”) with
tools that read real data — never invent numbers.

### Why a new kind

`AgentRecordKind` was record-scoped only:
`"contact" | "company" | "deal"`. Overview needed a fourth kind, `"pipeline"`,
with Me/Everyone as the id. Chain: header → bridge token claim → conversation
filing → agent preamble.

### Delivered

1. **Schema**: `AgentConversation.pipelineScope` (`me` \| `everyone`); record
   FKs null for pipeline sessions.
2. **Bridge**: `x-crm-pipeline` header → JWT `pipelineScope` (not through
   cuid()).
3. **Preamble**: Me/Everyone + 7-day pulse summary counts; pointer to
   `read_pipeline_pulse` vs `read_pipeline_report`.
4. **Tools**: `read_pipeline_pulse` via `loadPipelinePulse`;
   `read_pipeline_report` via `loadPipelineReport` (month / stage / closing /
   closed).
5. **UI**: `PipelineAgentPanel` on overview under the pulse strip.
6. **Instructions**: pipeline sessions use pulse for “what moved”, report for
   named months / closing / closed / by stage.

### Constraints (still hold)

- Intelligence stays in the agent; Nest only exposes mechanical reads.
- Respect Me / Everyone from the overview filters.
- No confidence scores; report observed change-log + deal fields only.

### Out of scope (still)

- Alert emails / Slack
- Per-rep digests
- Changing the 7-day / 14-day defaults without product ask
- Optional thin tools `list_stuck_deals` / `list_deal_moves` (not built —
  pulse tool + drill-down is enough)
- Nest `dashboard.summary` reuse of `loadPipelineReport` (UI already has
  forecast tables; agent has its own shared loader)
