# Tasks

TDD throughout: a failing vitest test first, then implementation. Follow the
existing health-context patterns — the `water-tracking` change is the closest
template (but simpler: no target, no add — just get + upsert). Run `npm test` +
`npm run typecheck` before finishing. JSON payloads use snake_case.

## 1. Domain

- [x] 1.1 Add `src/contexts/health/domain/bowel.ts`: `BowelLog { userId, day,
      count, isNormal, note }` (isNormal is `boolean | null`, note is `string`).
- [x] 1.2 Add `src/contexts/health/domain/bowel-repository.ts` — the
      `BowelRepository` port: `get(userId, day)` and `set(input)` (upsert keyed by
      userId+day). Define `SetBowelLogInput { userId, day, count, isNormal, note }`.

## 2. Application use cases

- [x] 2.1 Test first (fake repo) — `getBowelDay(repo, userId, day)`: returns the
      day's record; when there is none returns a default empty `{ day, count: 0,
      isNormal: null, note: '' }`. Implement
      `src/contexts/health/application/get-bowel-day.ts`. Define an explicit return
      DTO `BowelDay { day, count, isNormal, note }` (no userId — mirror `WaterDay`)
      and map BOTH the found-record and the no-record-default branches into it, so
      the default isn't a `BowelLog` type mismatch.
- [x] 2.2 Test first — `setBowelDay(repo, input)`: upserts the day's count /
      is_normal / note (including isNormal = null and an empty note). Implement
      `src/contexts/health/application/set-bowel-day.ts`.

## 3. Drizzle adapter + schema + migration

- [x] 3.1 Add a `bowelLog` table to `src/shared/db/schema.ts` (uuid pk, `user_id`
      references `users`, `day` date, `count` (integer/numeric), `is_normal`
      boolean nullable, `note` text (nullable or default ''), `unique(userId,
      day)`).
- [x] 3.2 Implement `src/contexts/health/adapters/drizzle-bowel-repository.ts`
      (`DrizzleBowelRepository`) implementing `BowelRepository`, mirroring
      `drizzle-water-repository.ts`'s upsert via `onConflictDoUpdate`.
- [x] 3.3 Run `npm run db:generate` and commit the generated `drizzle/000X_*.sql`.

## 4. HTTP routes + wiring

- [x] 4.1 Test first — `src/adapters/http/routes/bowel.ts` handlers via app tests
      (mirror `test/adapters/http/water.test.ts` / `app.test.ts`):
      `GET /api/bowel?day=` returns `{ day, count, is_normal, note }` (defaults for
      an unrecorded day); `PUT /api/bowel { day, count, is_normal, note }` upserts
      and returns it (including is_normal null and an empty note). Each requires
      auth and rejects a missing `day` / non-numeric `count`.
- [x] 4.2 Implement the route handler factories (use `resolveUserId`,
      `requireDay`, `requireFiniteNumber` for count). For `is_normal` and `note`
      there is NO reusable validator (validation.ts's `requireString` rejects
      empty strings, so it must NOT be used for the empty-note default) — coerce
      them inline: `is_normal` → `body.is_normal == null ? null : Boolean(body.is_normal)`;
      `note` → `typeof body.note === 'string' ? body.note : ''`. Register the
      routes in `src/adapters/http/app.ts` under `authMiddleware`, and wire a
      `DrizzleBowelRepository` in `src/index.ts` (mirror the water wiring). Making
      `bowelRepository` a REQUIRED field of `CreateAppOptions` forces updating
      ALL THREE existing `createApp` call sites in tests with a bowel-repo
      fake/stub so typecheck + tests stay green: `test/adapters/http/app.test.ts`,
      `test/adapters/http/meals.test.ts`, AND `test/adapters/http/water.test.ts`
      (its `buildApp` helper also constructs the app).

## 5. Gate

- [x] 5.1 `npm test` green + `npm run typecheck` clean. No changes to existing
      code beyond additive wiring in `app.ts`/`index.ts` + the test call sites.
