ALTER TABLE "care_log" ADD COLUMN "item_title" text;--> statement-breakpoint
ALTER TABLE "care_log" ADD COLUMN "item_category" text;--> statement-breakpoint
ALTER TABLE "care_log" ADD COLUMN "item_dose" text;--> statement-breakpoint
-- Hand-added backfill (drizzle-kit does not generate it): the columns above are
-- added nullable, filled from the item every existing row still points at
-- (today's cascade guarantees care_item_id is non-null and live), and only then
-- set NOT NULL. Adding them NOT NULL in one step would fail on any non-empty
-- table, and a later backfill in a separate migration would leave a window in
-- which the read path's snapshot fallback has nothing to fall back to.
UPDATE "care_log" SET "item_title" = ci."title", "item_category" = ci."category", "item_dose" = ci."dose" FROM "care_item" ci WHERE ci."id" = "care_log"."care_item_id";--> statement-breakpoint
ALTER TABLE "care_log" ALTER COLUMN "item_title" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "care_log" ALTER COLUMN "item_category" SET NOT NULL;--> statement-breakpoint
-- The DEFAULTs are for the deploy window, not for the application. CI runs
-- `db:migrate` BEFORE `wrangler deploy` (.github/workflows/deploy.yml), so for
-- the minutes between the two the OLD Worker is still serving and its
-- `care_log` inserts (POST /api/care/log, the edit, markMissedForUserDay and
-- retireOrphanedOccurrences inside running CareReminderWorkflow instances) do
-- not carry these columns at all. NOT NULL with no DEFAULT makes every one of
-- those writes fail with `null value in column "item_title" ... violates
-- not-null constraint` until the new code lands — verified against PGlite.
-- They are set AFTER the backfill on purpose: adding the columns with a
-- DEFAULT would have filled every existing row, so a row the backfill's join
-- missed would silently get '' instead of failing the SET NOT NULL above.
-- 'custom' is a real `CareCategory` value (src/contexts/notifications/domain/care-item.ts),
-- so a window row still reads back as a valid category. These DEFAULTs stay
-- permanently — they are also what makes rolling the code back (without the
-- migration) safe. No writer in the new code relies on them.
--
-- src/shared/db/schema.ts deliberately does NOT mirror these two DEFAULTs, and
-- neither does drizzle/meta/0036_snapshot.json (so `db:generate` will not try to
-- drop them). The DB-level default is for the deploy window, where the old
-- bundle is what is running and this repo's TypeScript is irrelevant. Leaving
-- the type-level default off is what makes a NEW writer that forgets a snapshot
-- column fail `npm run typecheck` instead of silently inserting '' / 'custom'.
ALTER TABLE "care_log" ALTER COLUMN "item_title" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "care_log" ALTER COLUMN "item_category" SET DEFAULT 'custom';--> statement-breakpoint
ALTER TABLE "care_log" ALTER COLUMN "care_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "care_log" ALTER COLUMN "care_schedule_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "care_log" DROP CONSTRAINT "care_log_care_item_id_care_item_id_fk";--> statement-breakpoint
ALTER TABLE "care_log" DROP CONSTRAINT "care_log_care_schedule_id_care_schedule_id_fk";--> statement-breakpoint
ALTER TABLE "care_log" ADD CONSTRAINT "care_log_care_item_id_care_item_id_fk" FOREIGN KEY ("care_item_id") REFERENCES "public"."care_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_log" ADD CONSTRAINT "care_log_care_schedule_id_care_schedule_id_fk" FOREIGN KEY ("care_schedule_id") REFERENCES "public"."care_schedule"("id") ON DELETE set null ON UPDATE no action;
