# Trip Planner

Sales reps plan a multi-day visit trip from a hub city: set days, radius,
deal-activity mode, optional must-visit clients, then work with the research
agent to build a day-by-day itinerary and download a PDF.

Mechanical data only in Nest/DB. Intelligence stays in the agent.

## Status

| Piece | Status |
| --- | --- |
| `TripPlan` schema + `AgentConversation.tripPlanId` | **DONE** |
| Shared `loadTripPlan` / `searchTripCandidates` / `writeTripItinerary` | **DONE** |
| Nest `tripPlans` tRPC + hub geocode + `companies.nearHub` | **DONE** |
| `/trip-planner` UI + nav (Plane) + multi company picker | **DONE** (UI polish 2026-08-04) |
| Agent kind `trip` + tools + preamble | **DONE** |
| Client PDF download (`jspdf`) | **DONE** |

## Locked decisions

1. **Persist trips** in Postgres; agent sessions key off `tripPlanId`.
2. **“Active” = deals only** — deal `createdAt` or `closedAt` within N years
   (same idea as map `dealYears`).
3. **No owner filter** — every account in the radius (ownership not ready).
4. **One agent** — extend the eve bridge; no second agent process.
5. **PDF** — client generate-and-download; do not store the file on the server.

## Architecture

| Piece | Role |
| --- | --- |
| `TripPlan` | Saved brief + optional structured `itinerary` JSON |
| `searchTripCandidates` (`@crm/db`) | Haversine radius + ACTIVE/SALVAGE deal window; shared by Nest + agent |
| `trip` AgentRecordKind | Header `x-crm-trip` → JWT `tripPlanId` → preamble + tools |
| `read_trip_plan` / `search_trip_candidates` / `write_trip_itinerary` | Agent tools |
| `/trip-planner` | List, brief form, agent panel, PDF download |

## Ranking (mechanical)

Must-visit first → open pipeline amount → deal count in window (ACTIVE) or
years since last deal (SALVAGE) → distance ascending. Cap ~60 for the agent.

## Key files

- `packages/db/prisma/schema.prisma` — `TripPlan`, enums, `tripPlanId`
- `packages/db/src/trip-plan.ts`
- `apps/api/src/trip-plans/*`
- `apps/app/app/(app)/trip-planner/*`
- `apps/app/components/crm/company-multi-picker.tsx`
- `apps/app/lib/trip-pdf.ts`
- `apps/agent/agent/tools/read_trip_plan.ts`
- `apps/agent/agent/tools/search_trip_candidates.ts`
- `apps/agent/agent/tools/write_trip_itinerary.ts`

## Out of scope (v1)

- Map overlay / driving directions / hotels
- Owner-scoped candidates
- Comms-based activity
- Server-stored PDF / emailing itinerary
- Sage calendar push
