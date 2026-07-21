# Tasks

TDD throughout: a failing vitest test first, then implementation. Follow the
existing health-context patterns (see `daily-target` as the closest template).
Run `npm test` + `npm run typecheck` before finishing. JSON payloads use
snake_case, matching the existing routes.

## 1. Domain

- [x] 1.1 Add `src/contexts/health/domain/water.ts`: `WaterIntake { userId, day,
      totalMl }` and `WaterTarget { userId, day, targetMl }` entity types.
- [x] 1.2 Add `src/contexts/health/domain/water-repository.ts` — the
      `WaterRepository` port: `getIntake(userId, day)`, `addIntake(userId, day,
      addMl)` (clamped ≥ 0), `getTarget(userId, day)`,
      `getLatestTargetOnOrBefore(userId, day)` (mirrors
      `DailyTargetRepository.getLatestOnOrBefore`), and `setTarget(input)` (upsert
      keyed by userId+day). Define `SetWaterTargetInput { userId, day, targetMl }`.

## 2. Application use cases (mirror diet)

- [x] 2.1 Test first — `getWaterDay(repo, userId, day)` with a fake repo:
      returns the exact day's target; carries forward the latest earlier target
      when the day has none; returns 0 when no target was ever set; reads the
      day's total; `remaining = target − total` and may be negative.
      Implement `src/contexts/health/application/get-water-day.ts` returning
      `{ day, totalMl, targetMl, remainingMl }` (structure mirrors
      `getDailyTargetWithRemaining`, minus meals).
- [x] 2.2 Test first — `addWater(repo, userId, day, addMl)`: adds to the total;
      a negative `addMl` reduces it but the stored total never goes below 0.
      Implement `src/contexts/health/application/add-water.ts`.
- [x] 2.3 Test first — `setWaterTarget(repo, input)`: upserts the day's target.
      Implement `src/contexts/health/application/set-water-target.ts` (mirrors
      `set-daily-target.ts`).

## 3. Drizzle adapter + schema + migration

- [x] 3.1 Add `waterIntake` and `waterTarget` tables to
      `src/shared/db/schema.ts` (mirror `dailyTarget`: uuid pk, `user_id`
      references `users`, `day` date, `numeric` amount(s), `unique(userId, day)`).
- [x] 3.2 Implement `src/contexts/health/adapters/drizzle-water-repository.ts`
      (`DrizzleWaterRepository`) implementing `WaterRepository`, mirroring
      `drizzle-daily-target-repository.ts` (upserts via `onConflictDoUpdate`,
      `getLatestTargetOnOrBefore` via `day <= given` ordered desc limit 1).
      `addIntake` clamps the stored total at 0.
- [x] 3.3 Run `npm run db:generate` and commit the generated `drizzle/000X_*.sql`
      migration for the two new tables.

## 4. HTTP routes + wiring

- [x] 4.1 Test first — `src/adapters/http/routes/water.ts` handlers via app
      tests (mirror `test/adapters/http/meals.test.ts` /
      `daily-target.test.ts`): `GET /api/water?day=` returns
      `{ day, total_ml, target_ml, remaining_ml }`; `POST /api/water { day, add_ml }`
      returns `{ day, total_ml }` and clamps at 0; `PUT /api/water/target
      { day, target_ml }` returns `{ day, target_ml }`. Each requires auth and
      rejects a missing `day` / non-numeric amount via the shared validators.
- [x] 4.2 Implement the route handler factories (use `resolveUserId`,
      `requireDay`, `requireFiniteNumber`), register them in
      `src/adapters/http/app.ts` under `authMiddleware`, and wire a
      `DrizzleWaterRepository` in `src/index.ts` (mirror the daily-target wiring).

## 5. Gate

- [x] 5.1 `npm test` green + `npm run typecheck` clean. No changes to existing
      diet code beyond additive wiring in `app.ts`/`index.ts`.
