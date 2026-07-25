## Why

The user wants to import their chaodays daily diet targets into lifeos, like the
other chaodays data. chaodays `GET /users/diet_menus` returns per-day portion
targets (staple/meat/fruit/veg) plus a water target; lifeos has a `daily_target`
table and a separate water target. This is the backend slice of a 5th chaodays
importer (the frontend is a follow-up in the `life-os` repo).

## What Changes

- **Client:** `ChaodaysClient.fetchDietMenus(session, from, to)` → per-day targets
  `{ date, staple, meat, fruit, veg, waterTargetMl }` (oil/sugar, content, sum_*
  dropped; raw `water` → `waterTargetMl`).
- **Use case `importChaodaysDietTarget`:** sign in, fetch menus, read existing daily
  targets + water targets for the range once each, then per day set the daily
  `base*` portions when no target exists (bonus preserved) and the water target when
  `waterTargetMl > 0` and none exists. Batched, idempotent, same auth/error contract
  as the other importers. Summary reports imported/skipped for each target kind.
- **Route:** `POST /api/import/chaodays/diet-target` (wired from the composition
  root, all repos already present).
- **Repositories (batched via `db.batch`):** `DailyTargetRepository.setMany`;
  `WaterRepository.listTargetRange` + `setTargetMany`. In-memory fakes mirror them.

Backend only. Gate = `npm test` + `npm run typecheck`.

## Capabilities

### Modified Capabilities

- `chaodays-import`: an authenticated lifeos user SHALL be able to import their
  chaodays daily diet targets — the per-day portion targets into daily targets and
  the per-day water target into the water target — for a date range, idempotently
  (skipping days that already have the corresponding target), reusing the chaodays
  connector's transient-credential and error contract.
