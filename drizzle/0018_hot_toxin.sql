ALTER TABLE "food_item" ADD COLUMN "seed_key" text;--> statement-breakpoint
-- Backfill seed_key = name for existing shared rows, so a row seeded before
-- this migration is still recognized as already-seeded by the new key. This
-- statement first executes unattended in `.github/workflows/deploy.yml:30-33`
-- after merge, so it must never abort the deployment.
--
-- This is deliberately the DEFENSIVE form, not a bare
-- `SET seed_key = name WHERE owner_user_id IS NULL`: two shared rows sharing
-- a name is a state the app can produce today (`food_item.name` has no
-- unique constraint and `create-shared-food-item.ts` does not check for
-- one), and the bare form would try to write the same seed_key into both,
-- violating the new partial unique index below and aborting the whole
-- deployment. The NOT EXISTS guard leaves any such row's seed_key null and
-- skips it instead — but a shared row left with a null seed_key is one the
-- next seed run will insert again (a third row with that name), so the
-- situation still needs a human to clean up; this backfill only keeps the
-- deployment from dying.
UPDATE "food_item" f SET "seed_key" = f."name"
WHERE f."owner_user_id" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "food_item" g
    WHERE g."owner_user_id" IS NULL AND g."name" = f."name" AND g."id" <> f."id"
  );--> statement-breakpoint
CREATE UNIQUE INDEX "food_item_seed_key_idx" ON "food_item" USING btree ("seed_key") WHERE seed_key is not null;