# Deploy the research agent on Railway

**Status (DONE 2026-08-03):** `app`, `api`, Postgres, API cron workers, and
the always-on **`agent`** (eve) service are on Railway. Follow-ups enqueue
is claimed by the dispatcher; Agent tab uses
`AGENT_URL=http://agent.railway.internal:2000`. Runtime note: start via
`scripts/railway-agent-start.sh` (Node 24 + `just-bash`, not `npx`/Bun).

This is the checklist to make the agent operational. Architecture detail lives
in [`docs/agent.md`](../agent.md). Env names live in
[`.env.example`](../../.env.example) and [`docs/environment.md`](../environment.md).

---

## Why you need a third long-running service

Three pieces, three jobs:

| Piece | What it does | Prod today |
| --- | --- | --- |
| `api` | Syncs mail; cron routes enqueue `AgentTask` rows | Online |
| `cron-followups` | Daily 8am CDT → `POST /internal/agent/followups` | Online |
| **`agent` (eve)** | Claims due `AgentTask`s every minute; runs the model; writes `FollowUpSuggestion` / enrichment | **Missing** |
| `app` | Proxies `/eve/v1/*` to the agent for the Agent tab | Online, but `AGENT_URL` still points nowhere useful |

```
cron-followups ──► api /internal/agent/followups ──► AgentTask rows in Postgres
                                                         │
app /eve/v1/*  ──► AGENT_URL (agent) ◄── dispatcher ◄────┘
                         │
                         ▼
                  FollowUpSuggestion / facts / briefs
```

Without `agent`, step 1 still returns `{"enqueued":N}` and the DB grows
`AgentTask` rows that nobody claims.

---

## What is already done

- [x] Nest follow-ups enqueue route + `CRON_SECRET`
- [x] Railway `cron-followups` at `0 13 * * *` UTC (8:00 AM CDT)
- [x] Microsoft / sequences / Sage crons (separate services)
- [x] App bridge code (`apps/app/app/eve/v1/[...path]/route.ts`)
- [x] Agent dispatcher (`apps/agent/agent/schedules/dispatch.ts`, cron `* * * * *`)
- [x] Local smoke (HANDOFF 2026-08-02): enqueue + `eve dev` dispatch wrote a
      real `FollowUpSuggestion`

## What you still have to do

### 1. Add a Docker image for the agent

There is **`Dockerfile.api`** and **`Dockerfile.app`**, but **no
`Dockerfile.agent` yet**. Add one modeled on `Dockerfile.api`:

- Base: `oven/bun:1.3`
- `bun install --frozen-lockfile`
- `bunx turbo run build --filter=agent` (outputs under `apps/agent/.eve`)
- Start: `bun run --cwd apps/agent start` (= `eve start`)
- Expose the port eve listens on (local default **2000**; set `PORT=2000` on
  the service if you pin it)

Commit that Dockerfile before (or with) the Railway service.

### 2. Create a Railway service named `agent`

In project **MM-CRM** / environment **production**:

1. New service from the same GitHub repo (`jj-mobilemark/crm`).
2. Dockerfile path: `Dockerfile.agent` (once it exists).
3. **Not** a cron service — this must stay **always on** so eve’s minute
   schedule can fire.
4. Private networking is enough for the app→agent hop; a public domain is
   optional (the browser never talks to the agent directly).

### 3. Set variables on `agent`

Copy from root `.env` / existing Railway secrets. Required for a useful prod
agent:

| Variable | Required? | Notes |
| --- | --- | --- |
| `DATABASE_URL` | **yes** | Same Postgres as `api` (Railway reference `${{Postgres.DATABASE_URL}}` or the shared URL `api` already uses) |
| `AI_GATEWAY_API_KEY` | **yes** off Vercel | Model calls fail without it (local smoke needed this) |
| `AGENT_BRIDGE_SECRET` | **yes** for Agent tab | Same value as on `app`. `openssl rand -base64 32` once |
| `PORT` | recommended | `2000` to match docs / `AGENT_URL` |

Optional (agent works with none; each unlocks a capability — see
`.env.example`):

`PERPLEXITY_API_KEY`, `RAPIDAPI_KEY`, `CONTEXT_DEV_API_KEY`, `GITHUB_TOKEN`,
`BLOB_READ_WRITE_TOKEN`.

Do **not** put Sage / Microsoft / `CRON_SECRET` on the agent unless a tool
actually needs them (today it does not).

### 4. Point the app at the agent

On Railway service **`app`**:

| Variable | Value |
| --- | --- |
| `AGENT_URL` | Private: `http://agent.railway.internal:2000` (adjust port if you chose another). Public only if you gave the agent a domain. |
| `AGENT_BRIDGE_SECRET` | **Identical** string as on `agent` |

Redeploy **`app`** after setting these (runtime env; no need to bake into the
Next build unless you later put them behind `NEXT_PUBLIC_*`, which you must
not).

Prefer the **internal** hostname the same way you use
`INTERNAL_API_URL=http://api.railway.internal:3001` for Nest — avoids
Cloudflare hairpin issues.

### 5. Deploy and smoke

1. Deploy `agent`; wait until healthy / listening.
2. From a machine with `CRON_SECRET`:

   ```bash
   curl -fsS -X POST \
     -H "Authorization: Bearer $CRON_SECRET" \
     https://api.mobilemarksalestool.com/internal/agent/followups
   ```

   Expect `{"enqueued":N}` with N ≥ 1 if at least one mailbox is connected.

3. Within ~1 minute, eve’s dispatcher should claim those tasks. Check agent
   logs for schedule `dispatch` / tool `propose_followups`.
4. In the CRM UI: open **`/follow-ups`** — new `PROPOSED` rows should appear.
5. Open any contact → **Agent** tab — should stream, not `502` / “not
   configured”.

Failure table (same as local, from `docs/agent.md`):

| Symptom | Cause |
| --- | --- |
| Agent tab `503` “not configured” | `AGENT_BRIDGE_SECRET` missing on **app** |
| Agent tab `401` | App and agent secrets differ |
| Agent tab `502` / offline | Agent down or `AGENT_URL` wrong on app |
| `enqueued` but empty `/follow-ups` | Agent not running, or no `AI_GATEWAY_API_KEY` |
| Model / gateway errors in agent logs | Missing or bad `AI_GATEWAY_API_KEY` |

---

## End-state diagram (all operational)

```
                    ┌──────────── cron-microsoft (*/5)
                    ├──────────── cron-sequences (*/5)
Railway crons ──────┼──────────── cron-followups (08:00 CDT)
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

## Out of scope for “agent online”

These are separate and already partly wired:

- Sequences send path still needs Entra **Mail.Send** on connected accounts.
- Optional enrichment vendors (Perplexity, LinkDAPI, …) are capability toggles,
  not required to process follow-up tasks from mailbox history alone.

---

## Suggested order of work for the next agent / human

1. Add `Dockerfile.agent` + Railway `agent` service (steps 1–2).
2. Set `DATABASE_URL` + `AI_GATEWAY_API_KEY` on `agent`; deploy.
3. Confirm dispatcher claims a manually enqueued follow-ups batch (step 5.2–5.3).
4. Set matching `AGENT_BRIDGE_SECRET` on `app` + `agent`; set `AGENT_URL` on
   `app`; redeploy app; smoke Agent tab (steps 4 + 5.5).
5. Update this file’s status line and `HANDOFF.md` Current state when green.
