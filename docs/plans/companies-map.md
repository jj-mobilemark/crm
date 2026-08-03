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
  `hasLocation`, sort `name`|`city`|`owner`.
- UI: rail **Map** → `/map` split view; pins colored mine (primary) /
  Sage 100 (`chart-2`) / no Sage 100 (`warning`).
- **Map ↔ list**: left list filters to the current viewport (`N in view`);
  cluster click narrows further; selecting a row flies to the pin and
  highlights it; **Open company** opens `CompanySheet` over `/map` via
  `useOpenRecord` (no navigate to `/companies`).

## Prod / local geocode (2026-08-03)

- Prod: full Nominatim pass via `railway ssh` → ~12,147 companies with
  coords (`fetchedOk=3651` unique places).
- Local: same coords imported with `pull-geocode-from-prod.ts`.

## Out of scope

Street-level geocode, live geocode on every Sage pull, agent tools.
