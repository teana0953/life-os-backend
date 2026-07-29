# Tasks

TDD throughout: a failing vitest test first, then implementation. Follow the
existing health-context patterns — `food-dictionary` for the port/adapter/use-case
shape and `user-timezone` for a user-scoped HTTP route test. JSON payloads use
snake_case. Run `npm test` + `npm run typecheck` before finishing.

Scope reminder: **create + edit shared items only**. No delete, no editing another
user's custom item, no admin-granting endpoint, no frontend.

Note on the two commands: `npm test` will NOT catch a type-level breakage
(vitest transpiles without type-checking), so the port/entity widenings in
sections 1–2 are only verified by `npm run typecheck` (task 8.2). Do not treat a
green `npm test` as proof that the fakes are up to date.

## 1. Admin flag on the user record

- [x] 1.1 Add `isAdmin: boolean` to `src/contexts/user/domain/user.ts` (doc comment:
      false by default; granted out of band by direct data change).
- [x] 1.2 Add `isAdmin: boolean("is_admin").notNull().default(false)` to the `users`
      table in `src/shared/db/schema.ts`.
- [x] 1.3 Generate the migration with `npm run db:generate` and commit the produced
      `drizzle/00xx_*.sql` + `drizzle/meta` updates. Verify the generated SQL is a
      single `ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL`
      (no destructive statement); do NOT hand-write the file.
- [x] 1.4 Map the column in `src/contexts/user/adapters/drizzle-user-repository.ts`
      (`toDomain` / the insert-returning path), so `getOrCreate` and `getById` return it.
- [x] 1.5 Fix every existing `User` object literal in `src/` and `test/` that now
      misses `isAdmin` (grep for `firebaseUid:` in test files). This is a compile
      error, invisible to `npm test` — confirm with `npm run typecheck`.

## 2. Repository port + adapter

- [ ] 2.1 Extend `src/contexts/health/domain/food-dictionary-repository.ts`:
      - `CreateSharedFoodItemInput` = the existing custom input **without**
        `ownerUserId`, **plus** `baseAmount: number | null` and
        `measureUnit: string | null`.
      - `UpdateSharedFoodItemPatch` = all editable fields optional: `name`,
        `carbG`, `proteinG`, `fatG`, `sugarG`, `fiberG`, `kcal`, `staple`, `meat`,
        `fruit`, `veg`, `baseAmount`, `measureUnit` (the last two may be
        explicitly `null`, which means "clear"; an absent key means "leave alone").
      - `findSharedById(id): Promise<FoodItem | null>` — matches only
        `ownerUserId === null`.
      - `createShared(input): Promise<FoodItem>` — inserts with `ownerUserId` null.
      - `updateSharedById(id, patch): Promise<FoodItem | null>` — applies only the
        supplied keys to a shared item; returns the updated item, or null when the
        id is absent or not shared.
- [ ] 2.2 Implement the three methods in
      `src/contexts/health/adapters/drizzle-food-dictionary-repository.ts`, reusing
      `toDomain`. `updateSharedById` builds its `set` object from the patch keys that
      are **present** (numbers stringified as elsewhere in this adapter, but an
      explicit `null` written as `null`, never `String(null)` → `"null"`), and scopes
      the `where` to `and(eq(foodItem.id, id), isNull(foodItem.ownerUserId))` so a
      user-owned item can never be hit. `createShared` writes `baseAmount` /
      `measureUnit` (the first write path in this adapter that touches them —
      `createCustom` never did).
- [ ] 2.3 Update **every** in-memory fake / stub implementing
      `FoodDictionaryRepository` so it satisfies the widened port: the
      `InMemoryFoodDictionaryRepository` in
      `test/contexts/health/application/food-dictionary.test.ts` (shared-only
      semantics mirrored, real behavior) and every `stubFoodDictionaryRepository`
      object literal across `test/` (grep `FoodDictionaryRepository` — ~16 sites,
      including `test/adapters/http/meals.test.ts`), where a throwing/no-op stub is
      fine. Again: only `npm run typecheck` catches a miss here.

## 3. Application use cases

- [ ] 3.1 Test first — `createSharedFoodItem(repo, input)`: creates an item with
      `ownerUserId === null`; rejects a measure basis with only one part supplied
      (base amount without unit, and unit without base amount) and creates nothing.
- [ ] 3.2 Implement `src/contexts/health/application/create-shared-food-item.ts`.
- [ ] 3.3 Test first — `updateSharedFoodItem(repo, id, patch)`:
      - partial patch changes only the supplied fields, leaving the rest intact;
      - an empty patch is rejected as invalid and nothing is written;
      - an id owned by a user, and an unknown id, both resolve to not-found
        (same outcome, no distinction);
      - post-patch invariant: patching `baseAmount: null` on an item that keeps a
        `measureUnit` is rejected and the item is unchanged; supplying **both**
        parts on an item with neither is accepted; clearing **both** parts together
        on an item that has them is accepted (the positive cases keep the negative
        ones from passing for the wrong reason).
- [ ] 3.4 Implement `src/contexts/health/application/update-shared-food-item.ts`.
      The invariant is evaluated on the **merged** (post-patch) state, so the use case
      reads the current item via `findSharedById` before validating, and must not
      write when validation fails. Return distinct, typed outcomes for not-found vs
      invalid so the route can map them to 404 vs 400.

## 4. Admin authorization

- [ ] 4.1 Test first — `resolveAdminUser(userRepository, claims)` returns the user
      when `isAdmin` is true and `null` when it is false (get-or-create still runs, as
      with `resolveUserId`).
- [ ] 4.2 Implement `resolveAdminUser` in `src/adapters/http/current-user.ts`
      alongside `resolveUserId` (no exception flow; `null` means forbidden).

## 5. Shared validation helpers (prerequisite for PATCH semantics)

- [ ] 5.1 Move `nullableString` and `nullableNumber` from
      `src/adapters/http/routes/care.ts:44,51` into
      `src/adapters/http/validation.ts` as exported helpers, and import them in
      `care.ts`. Pure move — no behavior change; `care` tests stay green as-is.
      Rationale: `optionalFiniteNumber` / `optionalFiniteNumberOrUndefined`
      (validation.ts:38,44) collapse `null` into "absent" and therefore cannot express
      "clear this field"; there is no string equivalent at all.

## 6. HTTP routes

- [ ] 6.1 Test first — `test/adapters/http/admin-food-dictionary.test.ts`, driving the
      app the way `test/adapters/http/user-timezone.test.ts` does (fake repositories,
      fake verifier):
      - `POST /api/admin/food-items` as an admin → `201`, response `owner_user_id`
        is null, and a *different* user's `GET /api/food-items` search finds it;
      - `POST` as a non-admin → `403 { error: "forbidden" }`, nothing created;
      - `POST` with `measure_unit` but no `base_amount` → `400`, nothing created;
      - `PATCH /api/admin/food-items/:id` as an admin with a subset of fields → `200`,
        only those fields changed;
      - `PATCH` with an empty body → `400`;
      - `PATCH` a user-owned item id → `404`, item unchanged;
      - `PATCH` an unknown (but well-formed) id → `404`;
      - `PATCH` a malformed, non-UUID id → `404` (not 500);
      - `PATCH` clearing `base_amount` while `measure_unit` remains → `400`, item
        unchanged; clearing **both** together → `200`;
      - `PATCH` as a non-admin → `403`, item unchanged;
      - both routes without an `Authorization` header → `401` (auth middleware runs
        before the admin check).
- [ ] 6.2 Implement the handlers in
      `src/adapters/http/routes/admin-food-dictionary.ts`, reusing the existing
      `toJson` shape (export it from `routes/food-dictionary.ts` rather than
      duplicating it). The PATCH handler distinguishes "key absent" from "key present
      with null" via `"key" in body` + the helpers from task 5.1 (absent = leave
      alone, explicit null = clear, meaningful only for the measure basis); it ignores
      `id` / `owner_user_id` / `created_at` if present in the body; and it rejects a
      `:id` that is not a well-formed UUID as `404` before touching the repository
      (`food_item.id` is a uuid column — passing garbage would raise Postgres 22P02
      and surface as a 500).
- [ ] 6.3 Wire both routes in `src/adapters/http/app.ts` behind `authMiddleware`,
      next to the existing `/api/food-items` block, and inject them from
      `src/index.ts` if the composition root needs it.
- [ ] 6.4 Test first, then implement — `GET /api/me` returns `is_admin`
      (`src/adapters/http/routes/me.ts` serializes fields one by one; add
      `is_admin: user.isAdmin`). Cover both an admin and a non-admin caller.

## 7. Seed must stop clobbering the shared catalog

- [ ] 7.1 Test first — put the skip logic in `seedFoodDictionary(db, rows)`
      (`src/contexts/health/adapters/seed/food-dictionary-seed.ts:116`), NOT in
      `run-seed.ts`: that file calls `main()` at module top level (run-seed.ts:40),
      which opens a real DB connection and calls `process.exit`, so importing it from
      a test is not possible. Note the existing
      `test/contexts/health/adapters/seed/food-dictionary-seed.test.ts` only covers
      the pure `seedRowToFoodItem` and has no db double — build one following
      `test/contexts/notifications/adapters/drizzle-care-item-repository.test.ts:10-21`
      (a hand-rolled object cast to `Db`).
      Behavior to pin: `seedFoodDictionary` first reads the existing **shared**
      (`owner_user_id IS NULL`) item names, inserts only the rows whose name is not
      among them, leaves every existing shared row untouched, and returns/logs how
      many were inserted vs skipped. (`SEED_ROWS` itself has no duplicate names, so
      name is a usable key.)
- [ ] 7.2 Then make `src/contexts/health/adapters/seed/run-seed.ts` a thin runner:
      drop the unconditional `db.delete(foodItem).where(isNull(foodItem.ownerUserId))`
      (line 35) from the default path and keep it only behind an explicit
      `process.argv` `--force` flag (`npm run db:seed -- --force`). Update the file's
      doc comment — it currently advertises the delete-then-reinsert contract
      (run-seed.ts:12-14) — and report the inserted/skipped counts. Also correct the
      now-stale rationale on `food_favorite`'s cascade (`src/shared/db/schema.ts:53-58`
      justifies it with "the seed reseeds shared items — a delete + reinsert"), which
      this task removes as the default behavior.
      Why sections 7.1-7.2 are in scope: without them, one `npm run db:seed` erases
      every admin correction and admin-created shared item, and cascade-deletes their
      favorites (`food_favorite.food_item_id` is `onDelete: cascade`, schema.ts:58).

## 8. Verify

- [ ] 8.1 `npm test` green.
- [ ] 8.2 `npm run typecheck` clean (the real gate for tasks 1.5 and 2.3).
- [ ] 8.3 `npx openspec validate add-admin-shared-food-editing --strict` passes.
- [ ] 8.4 Confirm no regression in existing dictionary behavior: search/favorites
      tests untouched and still green; `POST /api/food-items` still creates an
      owner-private item; `care` route tests still green after the helper move.
