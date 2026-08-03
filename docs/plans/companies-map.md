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

- API: `companies.mapList` — filters `owner` (`all`|`me`|`unassigned`|userId),
  `sage` (`all`|`linked`|`unlinked`), `hasLocation`, sort `name`|`city`|`owner`.
- UI: rail **Map** → `/map` split view; pins colored mine (primary) / Sage
  (`chart-2`) / no Sage (`warning`); **Open company** →
  `/companies?record=company:<id>`.

## Out of scope

Street-level geocode, live geocode on every Sage pull, agent tools.
