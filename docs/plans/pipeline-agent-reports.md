# Pipeline agent advanced reports

Give the overview pipeline agent mechanical DB report tools beyond the 7-day
pulse so questions like “pipeline for August 2026” can be answered from real
deal data — without inventing numbers.

## Status

| Piece | Status |
| --- | --- |
| Shared loader `loadPipelineReport` | **DONE** (2026-08-03) |
| Agent tool `read_pipeline_report` | **DONE** (2026-08-03) |
| Preamble / instructions / suggestion chip | **DONE** (2026-08-03) |
| Unit tests (month bounds + Me/Everyone) | **DONE** (2026-08-03) |

## When to use which tool

| Question shape | Tool |
| --- | --- |
| What moved / who’s stuck / lost this week | `read_pipeline_pulse` |
| August / closing / closed / by stage / forecast by close month | `read_pipeline_report` |

## Modes (`read_pipeline_report`)

- `open_by_stage` — open pipeline totals by CRM stage (unweighted primary)
- `forecast_by_close_month` — open deals by `expectedCloseDate` month; optional
  `month` (`YYYY-MM`) filters to one month
- `closing_in_month` — open deals with close date in `month` (required)
- `closed_in_month` — deals with `closedAt` in `month` (won / lost / unqualified)

Scope: `me` | `everyone` (pass `userId` for Me). Deal list capped at **40**;
aggregates stay full-accuracy (`truncated: true` when over the limit).

Money: prefer unweighted `amount` (deal value); include `weightedAmount` as
secondary. Never invent.

## Key files

- `packages/db/src/pipeline-report.ts` — shared loader
- `packages/db/test/pipeline-report.spec.ts`
- `apps/agent/agent/tools/read_pipeline_report.ts`
- `apps/agent/agent/lib/preamble.ts` — pulse vs report
- `apps/app/lib/agent-record.ts` — “What's closing this month?” chip
- `apps/app/lib/agent-transcript.ts` — transcript label

Related: `docs/plans/pipeline-pulse.md` (pulse + overview agent session).

## Smoke

Ask the overview agent: “What can you tell me about my pipeline for August
2026?” — expect `read_pipeline_report` with `month=2026-08` and real deal rows.
Redeploy Railway `agent` before expecting this in prod.

## Out of scope

- Custom SQL / chart generation
- Extending the pulse window (still 7 days)
- Alert digests / Slack
- Changing Nest `dashboard.summary` shape
