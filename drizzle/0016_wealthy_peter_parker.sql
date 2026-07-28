ALTER TABLE "care_occurrence" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "care_occurrence" ADD COLUMN "last_send_outcome" text;--> statement-breakpoint
ALTER TABLE "care_occurrence" ADD COLUMN "last_send_detail" text;--> statement-breakpoint
-- Backfill so the rollout doesn't re-notify. `shouldNotify` treats a NULL
-- `last_attempt_at` as always-due (it replaces the old `last_notified_at IS
-- NULL` first-fire condition), so without this every already-materialized,
-- still-unanswered slot — including `nag_interval_minutes = 0` ones already
-- delivered today — would get one extra push on the first tick after deploy,
-- contradicting "A single-fire reminder is not repeated".
--
-- `last_send_outcome = 'sent'` is an assumption, not an observation: under the
-- old code `last_notified_at` was written whenever the user had ANY
-- subscription, regardless of whether the push actually succeeded. 'sent' is
-- still the right value (any other outcome routes these rows into the retry
-- floor branch and re-sends, the very thing this backfill exists to prevent),
-- so the detail records that these rows were assumed, not measured.
UPDATE "care_occurrence"
SET "last_attempt_at" = "last_notified_at",
    "last_send_outcome" = 'sent',
    "last_send_detail" = 'backfill'
WHERE "last_notified_at" IS NOT NULL;
