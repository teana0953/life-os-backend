## Why

The app is adding an exercise tracker alongside diet, hydration, bowel, and
vitals: users log, per day, the activities they did and for how long. This is the
backend half — persistence and an authenticated HTTP API for the frontend (a
separate life-os change) to consume. Unlike the single-upsert trackers (bowel,
vitals) it is **cumulative**: a day holds a *list* of entries, each added and
deletable independently (mirroring how meals hold a list of items). This first
version is **pure logging** — it deliberately does NOT implement the "exercise
raises the day's food-portion target" coupling from chaodays (deferred to the
goals/dashboard change), nor a trend chart, nor a user-customizable activity
library.

## What Changes

- **Static activity library** (in-code constant, read-only, small): each activity
  has `{ id, name, category (aerobic | anaerobic), intensity }` (intensity is a
  descriptive label, e.g. `慢跑 8km/hr`). No DB table, no seed pipeline, no
  favorites, no custom activities in v1 — served read-only over the API.
- **New `exercise_log` store**: one row per logged entry (many per user per day),
  holding `activity_id` (validated against the static library at write time),
  `duration_minutes` (positive integer), and `note` (free text, default empty).
- **`/api/exercise` endpoints** (all authenticated):
  - `GET /api/exercise/activities` → the static activity library.
  - `GET /api/exercise?day=` → `{ day, entries: [...], total_minutes }`; each
    entry is enriched on read with its activity name/category from the library. A
    day with no entries reads an empty list and `total_minutes` 0.
  - `POST /api/exercise` `{ day, activity_id, duration_minutes, note }` → appends
    an entry and returns it. Rejects an unknown `activity_id` or a non-positive
    duration.
  - `DELETE /api/exercise/:id` → deletes the entry if owned by the caller;
    returns whether one was deleted.
- An `ExerciseRepository` port, its use cases (`listExerciseActivities`,
  `logExercise`, `getExerciseDay`, `deleteExerciseEntry`), a Drizzle adapter, a
  schema migration, and route/wiring in `app.ts` + `index.ts`, following the
  existing health-context patterns (closest templates: `water-tracking` for the
  shape, `meals` for the per-day list of deletable entries). No change to
  existing code beyond additive wiring.

## Capabilities

### Added Capabilities

- `exercise-tracking`: persist a per-user, per-day *list* of exercise entries
  (each referencing an activity from a static library, with a duration and an
  optional note) and expose them over an authenticated `/api/exercise` API for
  reading the day (with total duration), appending an entry, deleting an entry,
  and listing the activity library. Pure logging only — no food-target coupling,
  trend chart, or custom activities in this version.
