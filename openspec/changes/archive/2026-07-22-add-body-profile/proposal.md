## Why

The app is starting the goals/dashboard layer (feature C). Its first piece is a
**body profile** — the user's height and target weight — and a **weight-goal
overview** the dashboard's goal card shows: current weight, how much is left to
the target, an achievement rate, and BMI. This is the backend half; the frontend
dashboard card is a separate life-os change.

Height and target weight are a static-ish per-user profile (not a daily tracker),
mirroring chaodays' member data that drives its goal figures. Current weight comes
from the existing vitals tracker (its per-day weight), so this change also adds two
small read queries to the vitals repository.

## What Changes

- **New `body_profile` store**: one row per user holding `height_cm` and
  `target_weight_kg` (both nullable — unset until the user enters them).
- **Two additive vitals reads** (`VitalsRepository`): `getLatestWeight` and
  `getEarliestWeight` — the most recent / earliest recorded (non-null) weight for
  a user, used for the current weight and the achievement baseline. No change to
  vitals' existing behaviour.
- **Derived weight-goal overview, computed on read** (not stored):
  - `current_weight_kg` = the latest recorded weight (null when none)
  - `remaining_kg` = current − target (null when either is missing)
  - `bmi` = current ÷ (height/100)² (null when either is missing), 1 decimal
  - `achievement_rate` = `(baseline − current) / (baseline − target)` clamped to
    0–100, where `baseline` is the earliest recorded weight; null when there is no
    baseline, no current, no target, or baseline equals target.
- **`/api/body-profile` and `/api/weight-goal` endpoints** (all authenticated):
  - `GET /api/body-profile` → `{ height_cm, target_weight_kg }` (nulls when unset)
  - `PUT /api/body-profile` `{ height_cm?, target_weight_kg? }` → **partial upsert**
    (only the fields present in the body are updated; an absent field is left
    unchanged) → returns the profile.
  - `GET /api/weight-goal` → `{ height_cm, target_weight_kg, current_weight_kg,
    remaining_kg, achievement_rate, bmi }`.
- A `BodyProfileRepository` port, its use cases (`getBodyProfile`,
  `setBodyProfile`, `getWeightGoal`), a Drizzle adapter, a schema migration, and
  route/wiring in `app.ts` + `index.ts`, following the health-context patterns.
  Writing rejects a non-positive or non-numeric `height_cm`/`target_weight_kg`
  with 400 (via `BadRequestError`, so `onError` maps it to 400 not 500). No change
  to existing code beyond additive wiring and the two vitals reads.

## Capabilities

### Added Capabilities

- `body-profile`: persist a per-user body profile (height and target weight) and
  expose a computed weight-goal overview (current weight from vitals, remaining to
  target, achievement rate against the earliest recorded weight, and BMI) over an
  authenticated API. Profile and overview only — no portion-target auto-computation
  (needs biological sex) and no adherence-rate aggregation (feature C3) here.
