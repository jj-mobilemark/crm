# Research agent on Railway (ops)

**Status (DONE 2026-08-03):** always-on Railway service **`agent`** runs eve.
Follow-ups cron enqueues `AgentTask` rows; the dispatcher claims them. The app
proxies the Agent tab to
`AGENT_URL=http://agent.railway.internal:2000`.

Architecture and evidence rules: [`docs/agent.md`](../agent.md). Env names:
[`.env.example`](../../.env.example) and [`docs/environment.md`](../environment.md).

---

## How the three pieces fit

| Piece | Job | Prod |
| --- | --- | --- |
| `api` | Syncs mail; cron routes enqueue `AgentTask` rows | Online |
| `cron-followups` | Daily 8:00 AM CDT → `/internal/agent/followups` | Online |
| `cron-daily-tasks` | 14:00 + 15:00 UTC → daily task email (Chicago 9:00 gate) | Online |
| `cron-webform` | `*/5` → `/internal/sync/webform` (Customer Question → Screening) | Online |
| **`agent` (eve)** | Claims due tasks every minute; model + tools; writes suggestions / enrichment. Sync/cron auto-enqueue is **off** unless `AGENT_AUTO_ENRICH=true` on both `api` and `agent` — then only company sheet Re-enrich / Research runs. | Online |
| `app` | Proxies `/eve/v1/*` → `AGENT_URL` for the Agent tab | Online |

```
cron-followups ──► api /internal/agent/followups ──► AgentTask rows in Postgres
                                                         │
app /eve/v1/*  ──► AGENT_URL (agent) ◄── dispatcher ◄────┘
                         │
                         ▼
                  FollowUpSuggestion / facts / briefs
```

Without `agent`, enqueue still returns `{"enqueued":N}` and nobody claims the
rows.

---

## What is deployed

- [x] Nest follow-ups enqueue (`GET`/`POST` `/internal/agent/followups` + `CRON_SECRET`)
- [x] Railway crons: microsoft, sequences, followups, sage, daily-tasks, webform
- [x] App bridge (`apps/app/app/eve/v1/[...path]/route.ts`)
- [x] Agent dispatcher (`apps/agent/agent/schedules/dispatch.ts`)
- [x] `Dockerfile.agent` + `scripts/railway-agent-start.sh` on `main`
- [x] Railway service **`agent`** (always-on, same repo `jj-mobilemark/crm`)
- [x] App vars: `AGENT_URL`, matching `AGENT_BRIDGE_SECRET`
- [x] Agent vars: `DATABASE_URL`, `AI_GATEWAY_API_KEY`, `AGENT_BRIDGE_SECRET`,
      `PORT=2000` (optional capabilities as set — see below)

### Runtime shape (do not “simplify”)

| Concern | Choice | Why |
| --- | --- | --- |
| Image | `oven/bun:1.3` + **Node 24** from NodeSource | eve requires Node ≥ 24; Bun installs the workspace |
| Build | `bun install` + `turbo run build --filter=agent` | Same monorepo as api/app |
| Start | `scripts/railway-agent-start.sh` → `node …/eve/bin/eve.js start` | `npx`/npm rejects `packageManager: bun`; Bun cannot host `just-bash` Module patches |
| Sandbox | `just-bash` (runtime dep on `apps/agent`) | Railway has no Docker daemon / KVM for docker/microsandbox |
| Port | `PORT=2000` | Matches `AGENT_URL=http://agent.railway.internal:2000` |
| Networking | Private only is enough | Browser never talks to the agent; app proxies |

---

## Variables

### On service `agent`

| Variable | Required? | Notes |
| --- | --- | --- |
| `DATABASE_URL` | **yes** | Same Postgres as `api` (`${{Postgres.DATABASE_URL}}`) |
| `AI_GATEWAY_API_KEY` | **yes** | Model calls fail without it |
| `AGENT_BRIDGE_SECRET` | **yes** for Agent tab | Same string as on `app` |
| `PORT` | **yes** (pin) | `2000` |
| `AGENT_AUTO_ENRICH` | no | Default **off**. Set `true` with the same on `api` to restore sync/cron research. When off, dispatcher retires auto backlog and only claims manual company Re-enrich / Research. |

Optional capability keys (each unlocks one source; agent runs with none —
see `apps/agent/agent/lib/capabilities.ts`):

| Variable | Boot label |
| --- | --- |
| `RAPIDAPI_KEY` | LinkedIn (LinkDAPI) |
| `PERPLEXITY_API_KEY` | Web research |
| `CONTEXT_DEV_API_KEY` | Company brand data |
| `GITHUB_TOKEN` | Higher GitHub rate limits |
| `BLOB_READ_WRITE_TOKEN` | Avatar mirroring |

Put these **only on `agent`**, never on `app` / `api`. Do not put Sage /
Microsoft / `CRON_SECRET` on the agent unless a tool needs them (today none
do).

### On service `app`

| Variable | Value |
| --- | --- |
| `AGENT_URL` | `http://agent.railway.internal:2000` |
| `AGENT_BRIDGE_SECRET` | Identical to `agent` |

Redeploy `app` after changing these (runtime; not `NEXT_PUBLIC_*`). Prefer
the internal hostname the same way as
`INTERNAL_API_URL=http://api.railway.internal:3001`.

---

## Smoke / verify

1. Agent logs should show listening on `:2000` and capability on/off lines.
2. Enqueue (prod cron uses **GET**; POST also works):

   ```bash
   curl -fsS -X GET \
     -H "Authorization: Bearer $CRON_SECRET" \
     https://api.mobilemarksalestool.com/internal/agent/followups
   ```

   Expect `{"enqueued":N}` when at least one mailbox is connected. Use the
   **Railway `api` service** `CRON_SECRET` (local `.env` may differ).

3. Within ~1 minute, agent logs should show dispatch / follow-up tool work.
4. UI: **`/follow-ups`** for new `PROPOSED` rows; any contact → **Agent** tab
   should stream (not `502` / “not configured”).

| Symptom | Cause |
| --- | --- |
| Agent tab `503` “not configured” | `AGENT_BRIDGE_SECRET` missing on **app** |
| Agent tab `401` | App and agent secrets differ |
| Agent tab `502` / offline | Agent down or `AGENT_URL` wrong on app |
| `enqueued` but empty `/follow-ups` | Agent not running, or no `AI_GATEWAY_API_KEY` |
| Model / gateway errors in agent logs | Missing or bad `AI_GATEWAY_API_KEY` |
| Build: “couldn't locate Dockerfile.agent” | File not on the Git commit Railway built |
| Crash: npm `EBADDEVENGINES` / `packageManager bun` | Start used `npx`; use `railway-agent-start.sh` |
| `DefenseInDepthBox: Module._resolveFilename` | eve started under Bun; must be Node |

---

## Diagram

```
                    ┌──────────── cron-microsoft (*/5)
                    ├──────────── cron-sequences (*/5)
                    ├──────────── cron-webform (*/5)
Railway crons ──────┼──────────── cron-followups (08:00 CDT)
                    ├──────────── cron-daily-tasks (14:00+15:00 UTC)
                    └──────────── cron-sage (01:00 CDT)
                                      │
                                      ▼
                              api (Nest :3001)
                                      │
                     AgentTask rows ──┤
                                      │
app ── /eve/v1/* ── AGENT_URL ──► agent (eve :2000, always on)
                                      │
                                      ▼
                              Postgres (shared)
```

---

## Out of scope / optional next

- Sequences still need Entra **Mail.Send** on connected accounts.
- Extra enrichment keys (`PERPLEXITY_API_KEY`, `CONTEXT_DEV_API_KEY`, …) are
  toggles — not required for mailbox-based follow-ups. LinkedIn needs
  `RAPIDAPI_KEY` on **`agent`** only.
