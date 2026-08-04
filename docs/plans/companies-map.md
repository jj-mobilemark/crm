# Companies map

**Status:** DONE (2026-08-03)

City-level map of CRM companies at `/map`, with a filterable list beside
Leaflet pins ([shadcn-map](https://shadcn-map.vercel.app/)).

## What shipped

- Schema: `Company.latitude` / `longitude` / `geocodePlaceKey` / `geocodedAt`;
  `GeocodeCache` for unique place keys. Migration
  `20260803150000_add_company_geocode`.
- Sage pull now writes `stateCode` / `country` / `countryCode` and clears
  coords when location changes.
- Geocode: `apps/api/scripts/geocode-companies.ts` (Nominatim, 1 req/s,
  place-key cache). Run after deploy / when cities change:

  ```sh
  cd apps/api && bun run scripts/geocode-companies.ts --dry-run
  cd apps/api && bun run scripts/geocode-companies.ts
  ```

  Optional: copy prod coords into local DB with a Railway Postgres TCP
  proxy + `packages/db/scripts/pull-geocode-from-prod.ts`
  (`SOURCE_DATABASE_URL=…`).

- API: `companies.mapList` — filters `owner` (`all`|`me`|`unassigned`|userId),
  `sage` (`all`|`linked`|`unlinked` on **Sage 100** `sage100CustomerNo`),
  `hasLocation`, `dealYears` (`0` = any time; `1`–`10` = deal opened
  `createdAt` or closed `closedAt` within that many years), sort
  `name`|`city`|`owner`.
- UI: rail **Map** → `/map` split view; pins colored mine (primary) /
  Sage 100 (`chart-2`) / no Sage 100 (`warning`).
  Deal-years dropdown on the filter column.
- **Map ↔ list**: left list filters to the current viewport (`N in view`);
  cluster click narrows further; selecting a row flies to the pin and
  highlights it; **Open company** opens `CompanySheet` over `/map` via
  `useOpenRecord` (no navigate to `/companies`).

## Prod / local geocode (2026-08-03)

- Prod: full Nominatim pass via `railway ssh` → ~12,147 companies with
  coords (`fetchedOk=3651` unique places).
- Local: same coords imported with `pull-geocode-from-prod.ts`.

## Re-geocode after state/country backfill (2026-08-04)

City-only pins (`city||`) were wrong for ambiguous names (Englewood CO →
NJ, etc.). Clear stale keys and re-run with state in the place key:

```sh
cd apps/api
bun run scripts/geocode-companies.ts --refresh-stale --dry-run
bun run scripts/geocode-companies.ts --refresh-stale   # clear + geocode
# or, if coords already cleared:
bun run scripts/geocode-companies.ts --concurrency=4
```

Default provider is **Open-Meteo** (fast, free). `--provider=photon` or
`--provider=nominatim` (1 req/s) are available. Do not cache HTTP 429.

## Out of scope

Street-level geocode / pin precision, live geocode on every Sage pull, agent
tools. Full street + postal are stored for **display** (company sheet + map
selection preview) — see `Company.streetAddress` / `postalCode` and
`docs/plans/sage-crm-sync.md` §3.1.
