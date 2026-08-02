# Strict rules - Always review before starting any work

You should always check and see if there are any relevant skill files you should review before starting a task e.g. if you're working on better-auth, always review the better auth best practice skill - if you're working on prisma, review your prisma-database-setup skill.

## Handoff protocol — HANDOFF.md (read first, update last)

`HANDOFF.md` at the repo root is the running handoff log between agents.

- **Before starting any work**: read `HANDOFF.md`. Its "Current state" section
  and newest work-log entry tell you exactly where the last agent stopped,
  what deviated from the plan, and what to do next.
- **Before stopping** (task done, phase done, or you're interrupted): update
  `HANDOFF.md`. Append a new dated entry at the top of the work log answering:
  what was completed (with file paths), how and why, deviations from the plan
  or upstream ("None" if none), and the exact next step for the next agent.
  Also refresh the "Current state" section. Never rewrite or delete old
  entries.
- If you are executing a plan (e.g. `docs/plans/m365-expansion.md`), name the
  plan and phase in your entry so the next agent can find its place without
  guessing.

Please check below, if you're working on anything related review the rules and let the user know you've read them:

## Design
Read @docs/design.md

## API:
Read @docs/api.md

## The research agent (`apps/agent`):
Read @docs/agent.md

Every piece of intelligence in this repo lives there, not in the API. The
complete eve documentation ships in `apps/agent/node_modules/eve/docs` and
matches the installed version — read the relevant guide before writing eve code
rather than working from memory of the API.

ABSOLUTELY, no coauthoring commits.

## Environment / configuration:
Read @docs/environment.md

There is **one `.env`, at the root of the repo**, and `.env.example` is its
documentation. If you add a variable, add it to `.env.example` with a note on
what it does — and if the API reads it, declare it in
`apps/api/src/config/env.validation.ts` too. Never add a per-package `.env`.

Anything a self-hoster might not have is optional, and the code must work
without it: a missing key removes a capability, it never throws. See
`apps/agent/agent/lib/capabilities.ts` for the pattern.

## Contributing / licence

This repository is public and MIT-licensed. Before writing anything that ships:
no real customer names, addresses or company data in fixtures, tests,
screenshots or docs — the seed in `packages/db/prisma/seed.ts` is the source of
demo data. See @CONTRIBUTING.md and @SECURITY.md.

## Writing Style: ASD-STE100 Simplified Technical English

When responding, follow ASD-STE100 Simplified Technical English (STE) — a controlled 
writing standard developed by aerospace and defense organizations to produce clear, 
unambiguous technical text.

### Key Rules

- **Use approved words only.** Stick to a defined word list. Each word should have 
  exactly one meaning in this context — avoid synonyms or alternate senses.
- **Use one word for one idea.** Don't use two different words to describe the same thing.
- **Write short sentences.** Aim for 20 words or fewer per instruction/sentence.
- **Use active voice.** Write "Turn the switch," not "The switch must be turned."
- **Write short paragraphs.** Keep one topic per paragraph.

### Goal

The goal is easy reading, especially for readers who may not be native English 
speakers. Clear, simple text helps them understand and act correctly and safely.

### Application

Apply these rules to all responses in this agent's scope unless the user explicitly 
requests a different style.