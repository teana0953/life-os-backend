# Tasks

TDD throughout: a failing vitest test first, then implementation. Follow the
existing health-context patterns — `water-tracking` is the closest for shape and
`meals` for the per-day list of deletable entries. Initial version is **pure
logging**: no food-target coupling, no trend chart, no custom activity library.
Run `npm test` + `npm run typecheck` before finishing. JSON payloads use
snake_case.

## 1. Domain

- [x] 1.1 Add `src/contexts/health/domain/exercise-activity.ts`: the
      `ExerciseActivity { id, name, category: 'aerobic' | 'anaerobic', intensity }`
      type, an in-code constant `EXERCISE_ACTIVITIES` seeded with a small set of
      representative activities (慢跑/快走/骑车/游泳/重训… with intensity labels),
      and a `findActivity(id): ExerciseActivity | undefined` lookup.
- [x] 1.2 Add `src/contexts/health/domain/exercise-entry.ts`:
      `ExerciseEntry { id, userId, day, activityId, durationMinutes, note, createdAt }`.
- [x] 1.3 Add `src/contexts/health/domain/exercise-repository.ts` — the
      `ExerciseRepository` port: `addEntry(input)`, `listByDay(userId, day)`
      (ascending by createdAt), `deleteEntry(userId, entryId)` (owned-only, returns
      boolean). Define `AddExerciseEntryInput { userId, day, activityId,
      durationMinutes, note }`.

## 2. Application use cases

- [x] 2.1 Test first (domain unit) — `findActivity` hit / miss. (Covered with 1.1
      if written test-first.)
- [x] 2.2 Test first (fake repo) — `logExercise(repo, input)`: appends and returns
      an entry; rejects an `activityId` not in the library; rejects
      `durationMinutes <= 0`. Implement
      `src/contexts/health/application/log-exercise.ts` (throw a domain error for
      the invalid cases).
- [x] 2.3 Test first — `getExerciseDay(repo, userId, day)`: returns DTO
      `ExerciseDay { day, entries: ExerciseDayEntry[], totalMinutes }` where each
      `ExerciseDayEntry` enriches the stored entry with `activityName`/`category`
      from `findActivity` (null when the id is not in the library), and
      `totalMinutes` is the sum of durations; a day with no entries returns
      `{ day, entries: [], totalMinutes: 0 }`. Implement
      `src/contexts/health/application/get-exercise-day.ts`.
- [x] 2.4 Test first — `deleteExerciseEntry(repo, userId, entryId)`: returns true
      when the owned entry is deleted, false otherwise. Implement
      `src/contexts/health/application/delete-exercise-entry.ts`.
- [x] 2.5 Add `src/contexts/health/application/list-exercise-activities.ts`
      returning `EXERCISE_ACTIVITIES` (keeps HTTP off the domain constant directly).

## 3. Drizzle adapter + schema + migration

- [x] 3.1 Add an `exerciseLog` table to `src/shared/db/schema.ts` (uuid pk,
      `user_id` references `users`, `day` date, `activity_id` text,
      `duration_minutes` integer, `note` text nullable/default '', `created_at`
      timestamp default now, index on `(user_id, day)` — NO unique constraint,
      multiple entries per day are allowed).
- [x] 3.2 Implement `src/contexts/health/adapters/drizzle-exercise-repository.ts`
      (`DrizzleExerciseRepository`) implementing `ExerciseRepository`: `addEntry`
      inserts and returns; `listByDay` selects by `(user_id, day)` ordered by
      `created_at`; `deleteEntry` deletes by `(id, user_id)` and returns whether a
      row was deleted (`.returning()` length check).
- [x] 3.3 Run `npm run db:generate` and commit the generated `drizzle/000X_*.sql`.

## 4. HTTP routes + wiring

- [x] 4.1 Test first — `src/adapters/http/routes/exercise.ts` handlers via app
      tests (mirror `test/adapters/http/water.test.ts` / `bowel.test.ts`):
      `GET /api/exercise/activities` returns the library;
      `GET /api/exercise?day=` returns `{ day, entries, total_minutes }` (empty
      defaults for an unrecorded day, entries enriched with `activity_name`/
      `category`); `POST /api/exercise { day, activity_id, duration_minutes, note }`
      appends and returns the entry; `DELETE /api/exercise/:id` returns
      `{ deleted }` and does nothing for another user's entry. Each requires auth;
      writing rejects a missing `day`, an unknown `activity_id`, and a non-positive
      `duration_minutes`.
- [x] 4.2 Implement the route handler factories (use `resolveUserId`,
      `requireDay`; `duration_minutes` via `requireFiniteNumber` then assert `> 0`
      → 400 otherwise; `activity_id` validated via `findActivity` → 400 when
      absent; `note` coerced inline `typeof body.note === 'string' ? body.note : ''`
      — do NOT use `requireString`, it rejects empty strings). Register the four
      routes in `src/adapters/http/app.ts` under `authMiddleware`, and wire a
      `DrizzleExerciseRepository` in `src/index.ts` (mirror the water/bowel
      wiring). Making `exerciseRepository` a REQUIRED field of `CreateAppOptions`
      forces updating ALL FIVE existing app-construction call sites in tests with
      an exercise-repo fake/stub so typecheck + tests stay green:
      `test/adapters/http/app.test.ts`, `water.test.ts`, `bowel.test.ts`,
      `vitals.test.ts`, AND `meals.test.ts`.

## 5. Gate

- [x] 5.1 `npm test` green + `npm run typecheck` clean. No changes to existing
      code beyond additive wiring in `app.ts`/`index.ts` + the test call sites.
