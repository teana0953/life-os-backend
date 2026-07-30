# Tasks

TDD throughout: a failing vitest test first, then implementation. Run `npm test` +
`npm run typecheck` before finishing. `npm test` does NOT type-check (vitest
transpiles only), so anything type-level is verified by `npm run typecheck`.

Scope: give the seed a stable identity key so an administrator renaming a seeded
item stops causing a duplicate on the next seed run. Nothing else — no change to the
admin endpoints' behavior, no change to `--force` semantics, no API surface change.

## 1. Schema + migration

- [x] 1.1 Add `seedKey: text("seed_key")` (nullable) to `foodItem` in
      `src/shared/db/schema.ts`, with a short comment: set for seed-created rows,
      null for administrator-created shared items and users' custom items; it is the
      seed's identity key and never changes when `name` is corrected.
- [x] 1.2 Add a partial unique index in the same table definition —
      `uniqueIndex("food_item_seed_key_key").on(table.seedKey).where(sql\`seed_key is not null\`)`
      Both `uniqueIndex` and `sql` are new imports here: `uniqueIndex` from
      `drizzle-orm/pg-core` (schema.ts:1 imports `index`/`unique` from there but not
      `uniqueIndex`) and `sql` from `drizzle-orm` (the file has no `drizzle-orm`
      import line yet — add one). Name the index in the file's existing `_idx` style
      rather than `_key`.
- [x] 1.3 Generate the migration with `npm run db:generate` — do NOT hand-write the
      ADD COLUMN or the index. drizzle-kit emits exactly two statements, in this
      order: `ALTER TABLE "food_item" ADD COLUMN "seed_key" text;` then
      `CREATE UNIQUE INDEX "food_item_seed_key_key" ...`. **Insert the backfill by
      hand BETWEEN them** (with its own `--> statement-breakpoint`), never after the
      index. Precedents for a hand-written statement inside a generated migration:
      `drizzle/0004_chubby_tomorrow_man.sql:6-7` (same `food_item` table) and
      `drizzle/0016_wealthy_peter_parker.sql:17-21`.
- [x] 1.4 The backfill must be the **defensive** form — a bare
      `SET seed_key = name WHERE owner_user_id IS NULL` is not acceptable:
      ```sql
      UPDATE "food_item" f SET "seed_key" = f."name"
      WHERE f."owner_user_id" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "food_item" g
          WHERE g."owner_user_id" IS NULL AND g."name" = f."name" AND g."id" <> f."id"
        );
      ```
      Reason, recorded in a comment above it: this statement first executes
      unattended in `.github/workflows/deploy.yml:30-33` after merge. Two shared rows
      sharing a name is a state the app can produce today (`food_item.name` has no
      unique constraint and `create-shared-food-item.ts` does not check for one); the
      bare form would violate the new partial unique index and abort the whole
      deployment. This form leaves such rows null and skips them instead — and say so
      plainly in the comment, including the consequence: a shared row left with a null
      `seed_key` is one the next seed run will insert again (a third row with that
      name), so the situation still needs a human to clean up; the backfill only keeps
      the deployment from dying.
- [x] 1.5 Do NOT run `npm run db:migrate` or `npm run db:seed` — they hit the real
      database; CI runs the migration on merge.

## 2. Seed keys off `seed_key`

- [x] 2.1 Test first — `test/contexts/health/adapters/seed/food-dictionary-seed.test.ts`.
      Note the existing `Db` double `fakeDbWithExistingSharedNames` (lines ~207-221)
      **cannot be extended**: it ignores the select projection and returns
      `existingNames.map((name) => ({ name }))`, so once the implementation reads
      `row.seedKey` every fake row yields `undefined` and nothing is ever skipped.
      Reshape it to return `{ seedKey }` rows (rename accordingly) and rewrite the
      three existing `seedFoodDictionary` cases in terms of seed keys. Cases to cover:
      - a shared row whose `seed_key` matches a seed row is skipped **even though its
        `name` differs** — the regression this whole change exists for;
      - a shared row with a null `seed_key` whose `name` equals a seed row's name does
        NOT suppress that row (name is no longer the key);
      - every inserted row carries `seedKey` equal to its seed row's name;
      - empty catalog still inserts all rows; all-keys-present still inserts none;
        `{ inserted, skipped }` keeps its shape.
- [x] 2.2 Implement in `src/contexts/health/adapters/seed/food-dictionary-seed.ts`:
      select `seed_key` instead of `name` for the existing-set query (keep the
      `isNull(foodItem.ownerUserId)` scoping — a user's private custom item must still
      never suppress a seed row), compare `row.name` against that set, and write
      `seedKey: row.name` in the inserted values. Update the function's doc comment,
      which currently explains the name-based rule.
- [x] 2.3 Check `src/contexts/health/adapters/seed/run-seed.ts`: the `--force` path
      deletes shared rows then calls `seedFoodDictionary`, so it inherits the new
      behavior — confirm there is no separate insert path needing the column, and
      leave the file alone if so.

## 3. Keep the key out of the API

- [x] 3.1 Test first — assert what is actually observable through the HTTP seam (the
      admin tests drive the app with in-memory `FoodDictionaryRepository` fakes, and
      per 3.3 `seedKey` is NOT on the `FoodItem` domain type, so there is no field on
      the returned item to assert against):
      - in `test/adapters/http/admin-food-dictionary.test.ts`: a `POST` body carrying
        `seed_key` still succeeds and the `CreateSharedFoodItemInput` handed to the
        fake repository has no `seedKey` property; a `PATCH` body carrying `seed_key`
        leaves the `UpdateSharedFoodItemPatch` free of it (and `seed_key` alone in the
        body is treated as an empty patch → 400);
      - no admin response body contains a `seed_key` key;
      - the dictionary search/read response shape likewise has no `seed_key`.
- [x] 3.2 Implement whatever those tests require — expected to be nothing beyond
      leaving `toJson` (`src/adapters/http/routes/food-dictionary.ts`) and both admin
      handlers untouched, since they whitelist fields rather than echo the body. Do
      NOT add `seedKey` to `CreateSharedFoodItemInput` or `UpdateSharedFoodItemPatch`.
- [x] 3.3 Do NOT add `seedKey` to the `FoodItem` domain type: `toDomain`
      (`src/contexts/health/adapters/drizzle-food-dictionary-repository.ts`) is an
      explicit whitelist mapper, so ignoring the new column is a no-op, nothing in
      domain or application logic reads it, and adding it would force every fake in
      `test/` to change. Record that in a one-line comment next to the schema column.

## 4. Verify

- [x] 4.1 `npm test` green (see the passing summary, not merely no red).
- [x] 4.2 `npm run typecheck` clean.
- [x] 4.3 `npx openspec validate add-seed-stable-key --strict` passes.
- [x] 4.4 Re-read the generated migration: ADD COLUMN → backfill → partial unique
      index, in that order, no destructive statement anywhere.
- [ ] 4.5 **Immediately before merging** (not at implementation time), re-verify the
      backfill's precondition against the live database, because the backfill runs
      unattended on merge and its correctness depends on database state, not on code:
      every shared row (`owner_user_id IS NULL`) still matches a `SEED_ROWS` name
      one-to-one, no shared row shares a name with another, and no seeded item has
      been renamed since 2026-07-30. If any of those has drifted, STOP and resolve by
      hand — a rename that happens before this migration lands would bake the new name
      in as the seed key and permanently re-create the very defect being fixed.
      This is a manual, read-only check with no npm script (task 1.5 forbids the two
      DB-touching ones) and no owner inside the loop — the loop's `finish: pr` stops
      at a human PR gate, and `tasks.md` is archived before the PR body is written, so
      nothing automated will run it. Run it as a throwaway `npx tsx` script in the
      repo root reading `DATABASE_URL` out of `.dev.vars` (the same way
      `src/contexts/health/adapters/seed/run-seed.ts:18-31` does), comparing
      `select name from food_item where owner_user_id is null` against `SEED_ROWS`,
      then delete the script. Record the result in the PR body.
