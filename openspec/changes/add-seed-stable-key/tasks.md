# Tasks

TDD throughout: a failing vitest test first, then implementation. Run `npm test` +
`npm run typecheck` before finishing. `npm test` does NOT type-check (vitest
transpiles only), so widening anything type-level is verified by `npm run typecheck`.

Scope: give the seed a stable identity key so an administrator renaming a seeded
item stops causing a duplicate on the next seed run. Nothing else — no change to the
admin endpoints' behavior, no change to `--force` semantics, no API surface change.

## 1. Schema + migration

- [ ] 1.1 Add `seedKey: text("seed_key")` (nullable) to `foodItem` in
      `src/shared/db/schema.ts`, with a short comment: set for seed-created rows,
      null for administrator-created shared items and users' custom items; it is the
      seed's identity key and never changes when `name` is corrected.
- [ ] 1.2 Add a partial unique index on it in the same table definition —
      `uniqueIndex("food_item_seed_key_key").on(table.seedKey).where(sql\`seed_key is not null\`)`
      (follow whatever index style the file already uses; `schema.ts` already imports
      `index`/`unique`).
- [ ] 1.3 Generate the migration with `npm run db:generate` (do NOT hand-write the
      ADD COLUMN / index statements), then **append the backfill by hand** to the
      generated file:
      `UPDATE "food_item" SET "seed_key" = "name" WHERE "owner_user_id" IS NULL;`
      with a comment recording why it is exact — the live catalog holds 271 shared
      rows matching the 271 seed rows one-to-one, no administrator-created shared item
      exists, and no rename has happened yet. `drizzle/0014_add-medication-reminders.sql`
      and `drizzle/0016_wealthy_peter_parker.sql` are the precedents for a hand-added
      backfill inside a generated migration.
      Order matters: the backfill must run BEFORE the unique index is created, or a
      duplicate would abort the migration mid-way; verify the statement order in the
      produced file and reorder if drizzle put the index first.
- [ ] 1.4 Do NOT run `npm run db:migrate` or `npm run db:seed` — they hit the real
      database; CI runs the migration on merge.

## 2. Seed keys off `seed_key`

- [ ] 2.1 Test first — extend
      `test/contexts/health/adapters/seed/food-dictionary-seed.test.ts` (it already has
      a hand-rolled `Db` double for `seedFoodDictionary`):
      - an existing shared row whose `seed_key` matches a seed row is skipped **even
        though its `name` differs** (the regression this change exists for);
      - an existing shared row with a null `seed_key` whose `name` equals a seed row's
        name does NOT suppress that row (name is no longer the key);
      - every inserted row carries `seedKey` equal to its seed row's name;
      - the empty-catalog case still inserts all rows, and the all-present case still
        inserts none, with `{ inserted, skipped }` unchanged in shape.
- [ ] 2.2 Implement in `src/contexts/health/adapters/seed/food-dictionary-seed.ts`:
      select `seed_key` instead of `name` for the existing-set query (keep the
      `isNull(foodItem.ownerUserId)` scoping), compare `row.name` against that set, and
      write `seedKey: row.name` in the inserted values. Update the function's doc
      comment, which currently explains the name-based rule.
- [ ] 2.3 Check `src/contexts/health/adapters/seed/run-seed.ts`: the `--force` path
      deletes shared rows then calls `seedFoodDictionary`, so it inherits the new
      behavior — confirm no separate insert path needs the column, and leave it alone
      if so.

## 3. Keep the key out of the API

- [ ] 3.1 Test first — in `test/adapters/http/admin-food-dictionary.test.ts`: a
      `POST /api/admin/food-items` body carrying `seed_key` creates an item whose
      `seed_key` is null, and a `PATCH` body carrying `seed_key` does not change it;
      neither response contains a `seed_key` field. In
      `test/contexts/health/application/food-dictionary.test.ts` (or the http search
      test), assert the search/read response shape has no `seed_key`.
- [ ] 3.2 Implement whatever those tests require — expected to be nothing more than
      leaving `toJson` (`src/adapters/http/routes/food-dictionary.ts`) and the two
      admin handlers untouched; if any of them would echo an unknown body key, fix it
      there. Do NOT add `seedKey` to `CreateSharedFoodItemInput` or
      `UpdateSharedFoodItemPatch`.
- [ ] 3.3 The `FoodItem` domain type: decide deliberately whether `seedKey` belongs on
      it. Preference is NO — nothing in domain or application logic reads it, it exists
      only inside the seed adapter, and adding it forces every fake in `test/` to
      change. If the Drizzle row mapper (`toDomain`) must ignore the column, that is
      the whole story; record the decision in a one-line comment.

## 4. Verify

- [ ] 4.1 `npm test` green (see the passing summary, not merely no red).
- [ ] 4.2 `npm run typecheck` clean.
- [ ] 4.3 `npx openspec validate add-seed-stable-key --strict` passes.
- [ ] 4.4 Read the generated migration one more time: ADD COLUMN, then backfill, then
      the partial unique index; no destructive statement anywhere.
