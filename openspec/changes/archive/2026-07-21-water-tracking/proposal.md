## Why

The app is adding a hydration tracker: users log how much water they drink each
day against a daily goal. This is the backend half — persistence and an HTTP API
for the frontend (a separate life-os change) to consume. It mirrors the existing
diet daily-target model so the target behaves exactly like the portion target
users already know.

## What Changes

- **New `water_intake` store**: one row per user per day holding the day's
  running total millilitres. Adding water upserts `total_ml = max(0, total_ml +
  add_ml)` (a negative `add_ml` corrects a mistake, clamped at zero).
- **New `water_target` store** with the **same carry-forward resolution as
  `daily_target`**: a day's target is the exact row for that day if set,
  otherwise the target carried forward from the most recent earlier day that has
  one, otherwise zero. Setting a target upserts that day's row. Single
  `target_ml` scalar (no bonus — water has no bonus concept).
- **`/api/water` endpoints** (all authenticated):
  - `GET /api/water?day=` → `{ day, total_ml, target_ml, remaining_ml }`
    (`remaining_ml = target_ml − total_ml`, may be negative).
  - `POST /api/water` `{ day, add_ml }` → `{ day, total_ml }`.
  - `PUT /api/water/target` `{ day, target_ml }` → `{ day, target_ml }`.
- A `WaterRepository` port, its use cases (`getWaterDay`, `addWater`,
  `setWaterTarget`), a Drizzle adapter, a schema migration, and route/wiring in
  `app.ts` + `index.ts`, following the existing health-context patterns. No
  change to existing diet code.

## Capabilities

### Added Capabilities

- `water-tracking`: persist a per-user, per-day water intake total and a per-day
  water target (carry-forward, mirroring the diet daily target), and expose them
  over an authenticated `/api/water` API for logging water and setting the goal.
