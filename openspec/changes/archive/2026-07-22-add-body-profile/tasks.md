# Tasks

TDD throughout: a failing vitest test first, then implementation. Follow the
health-context patterns — `add-menstrual-tracking` is the closest recent template
(a computed read DTO + partial upsert + a pure stats helper). Run `npm test` +
`npm run typecheck` before finishing. JSON payloads use snake_case.

## 1. Domain

- [x] 1.1 Add `src/contexts/health/domain/body-profile.ts`:
      `BodyProfile { userId, heightCm: number | null, targetWeightKg: number | null }`.
- [x] 1.2 Add `src/contexts/health/domain/body-profile-repository.ts` — the
      `BodyProfileRepository` port: `get(userId)` and `upsert(userId, patch)`.
      Define `UpdateBodyProfilePatch { heightCm?: number; targetWeightKg?: number }`
      — a **partial** update applying only the fields present on the patch.
- [x] 1.3 Add pure helpers `src/contexts/health/domain/weight-goal-stats.ts`
      (domain, no outer imports): `computeBmi(weightKg, heightCm)` = `weight /
      (height/100)^2` rounded to 1 decimal, null when either is null or ≤ 0;
      `computeAchievementRate(baseline, current, target)` = `(baseline − current) /
      (baseline − target) × 100` clamped to 0–100 and rounded to an integer, null
      when any input is null or `baseline === target`. Test first with the worked
      example (baseline 55, current 52, target 51 → 75) plus the null/clamp cases.

## 2. Application use cases

- [x] 2.1 Test first (fake repo) — `getBodyProfile(repo, userId)`: returns the
      profile; when none, returns the default `{ heightCm: null, targetWeightKg:
      null }`. Implement `src/contexts/health/application/get-body-profile.ts`.
- [x] 2.2 Test first — `setBodyProfile(repo, userId, patch)`: validates that any
      provided `heightCm`/`targetWeightKg` is a positive number (throws a domain
      error otherwise), then upserts; a patch with only one field leaves the other
      unchanged. Implement `src/contexts/health/application/set-body-profile.ts`.
- [x] 2.3 Test first — `getWeightGoal(bodyProfileRepo, vitalsRepo, userId)`: returns
      `WeightGoalOverview { heightCm, targetWeightKg, currentWeightKg, remainingKg,
      achievementRate, bmi }`, where currentWeightKg = `vitalsRepo.getLatestWeight`,
      the baseline = `vitalsRepo.getEarliestWeight`, remainingKg = current − target
      (null when either missing), and bmi/achievementRate via the 1.3 helpers.
      Cover: full overview (165/51/earliest 55/latest 52 → current 52, remaining 1,
      bmi 19.1, achievement 75); no target → remaining & achievement null; a single
      recorded weight (baseline === current) → achievement null. Implement
      `src/contexts/health/application/get-weight-goal.ts`.

## 3. Drizzle adapter + vitals reads + schema + migration

- [x] 3.1 Add a `bodyProfile` table to `src/shared/db/schema.ts` (`user_id` uuid
      references `users` as the primary key / unique, `height_cm` numeric nullable,
      `target_weight_kg` numeric nullable, `updated_at` timestamp default now).
- [x] 3.2 Implement `src/contexts/health/adapters/drizzle-body-profile-repository.ts`
      (`DrizzleBodyProfileRepository`): `get` selects by user_id; `upsert` builds the
      update set from ONLY the patch's present fields and inserts-or-updates keyed
      by user_id (`onConflictDoUpdate`), a no-op empty patch returning the current
      row (guard against a Drizzle `.set({})`).
- [x] 3.3 Add `getLatestWeight(userId)` and `getEarliestWeight(userId)` to the
      `VitalsRepository` port and `DrizzleVitalsRepository`: select `weight_kg` where
      `user_id` matches and `weight_kg` is not null, ordered by `day` desc / asc,
      limit 1; return the number or null. Additive — no change to existing vitals
      behaviour.
- [x] 3.4 Run `npm run db:generate` and commit the generated `drizzle/000X_*.sql`.

## 4. HTTP routes + wiring

- [x] 4.1 Test first — `src/adapters/http/routes/body-profile.ts` handlers via app
      tests (mirror `test/adapters/http/menstrual.test.ts`): `GET /api/body-profile`
      → `{ height_cm, target_weight_kg }` (nulls when unset); `PUT /api/body-profile
      { height_cm?, target_weight_kg? }` partial-upserts and returns it (a PUT of
      only `target_weight_kg` leaves `height_cm` unchanged); `GET /api/weight-goal`
      → the full overview. Each requires auth; a non-positive / non-numeric
      height/target → 400 and the stored profile is unchanged.
- [x] 4.2 Implement the route handlers (use `resolveUserId`). **PUT builds the patch
      by KEY PRESENCE** (mirror menstrual): `if ('height_cm' in body) patch.heightCm
      = parsePositiveNumber(body.height_cm, 'height_cm')`; likewise `target_weight_kg`.
      Add a small `parsePositiveNumber` (a finite number > 0 → itself, else throw
      `BadRequestError`) so a junk value (0 / negative / string / object) is a 400,
      never silently dropped. Register the three routes in `src/adapters/http/app.ts`
      under `authMiddleware`, and wire a `DrizzleBodyProfileRepository` (reusing the
      existing `vitalsRepository`) in `src/index.ts`. Making `bodyProfileRepository`
      a REQUIRED field of `CreateAppOptions` forces updating ALL SEVEN existing
      app-construction call sites in tests with a body-profile fake/stub:
      `test/adapters/http/app.test.ts`, `water.test.ts`, `bowel.test.ts`,
      `vitals.test.ts`, `exercise.test.ts`, `meals.test.ts`, AND `menstrual.test.ts`.
      **Also** add the two new methods (`getLatestWeight`/`getEarliestWeight`) to any
      fake `VitalsRepository` used in tests so typecheck stays green.

## 5. Gate

- [x] 5.1 `npm test` green + `npm run typecheck` clean. No changes to existing code
      beyond additive wiring in `app.ts`/`index.ts`, the two additive vitals reads,
      and the test call sites.
