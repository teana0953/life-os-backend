## Why

LifeOS needs its first health-domain capability: diet tracking. Research of
chaodays.app and reverse-engineering the user's existing 271-row food→portion
spreadsheet (see `docs/research/chaodays-health-tracking.md`) established that
the Taiwanese "portion exchange" (份數) system is a *lossy integer packing* of
underlying nutrients. To stay future-proof — the user wants精確 manual input now
and AI photo estimation later — the store of record must be nutrients, with
portions and calories as derived projections, not the other way around.

## What Changes

- Introduce a `health` bounded context under `src/contexts/health/`, following
  the existing `contexts/user/` layout (domain / application / adapters).
- Add a **food dictionary**: a lookup table of foods with household units
  (碗/片/湯匙/克) seeded from the user's 271-row spreadsheet. The spreadsheet
  stores portions; at seed time each row is converted to estimated nutrients
  using the standard per-portion definitions, so dictionary items carry both.
- Add **diet logging**: per-day, per-meal food entries whose store-of-record is
  the atomic nutrient layer `{ carb_g, protein_g, fat_g, sugar_g, fiber_g,
  kcal }`. Portions and calories are computed projections, never persisted as
  the source of truth. Each entry records its `source` (`manual` / `ai_photo` /
  `dict`) so future AI-photo input flows through the same atomic layer.
- Add a **nutrient↔portion↔calorie conversion layer** as pure domain logic
  (Taiwan MOHW standard: staple = carb÷15, protein = protein÷7, fruit = carb÷15
  ≈60kcal, vegetable = carb÷5), unit-tested against the reverse-engineered
  calibration points.
- Add a **daily target** record holding per-category portion goals for a day,
  with a reserved additive field for future exercise bonuses. Targets are set
  explicitly in this change; automatic computation from body metrics is
  out of scope (see Impact / deferred).

## Capabilities

### New Capabilities
- `food-dictionary`: a searchable catalog of foods keyed by household-unit
  descriptions, each carrying atomic nutrients and stored food-group portions;
  supports user-custom entries and favorites; seeded from the 271-row table.
- `diet-tracking`: per-day per-meal food entries stored as atomic nutrients,
  projected to portions/calories on read; plus per-day portion targets. Owns
  the nutrient↔portion↔calorie conversion rules.

### Modified Capabilities
<!-- None. daily_target is self-contained in this change; body-metric-driven
     target computation is deferred to a future user-profile change. -->

## Impact

- **New context**: `src/contexts/health/` (domain, application, adapters).
- **New DB tables** (Drizzle → Neon): `food_item`, `food_entry`,
  `daily_target`. New migration + seed script for the 271-row dictionary.
- **New HTTP routes** under `src/adapters/http/routes/` for dictionary lookup
  and diet entry create / day-view / delete; wired from the composition root
  `src/index.ts`.
- **No changes** to existing `users`, `auth`, or `api-platform` behavior.
- **Deferred (not in this change)**: automatic daily-target computation from
  body metrics (needs sex/height/weight fields + a TDEE→portion formula — a
  separate decision), the exercise/weight/water/bowel/period modules, and the
  actual AI-photo estimation implementation (only the `source` seam is added
  now).
