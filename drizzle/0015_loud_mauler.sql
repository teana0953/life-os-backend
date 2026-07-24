CREATE TYPE "public"."care_log_status" AS ENUM('done', 'skipped', 'missed');--> statement-breakpoint
CREATE TABLE "care_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"dose" text,
	"stock" integer,
	"stock_alert" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "care_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"care_item_id" uuid NOT NULL,
	"care_schedule_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"time_of_day" text NOT NULL,
	"status" "care_log_status" NOT NULL,
	"done_time" timestamp with time zone,
	"dose_quantity" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "care_log_care_schedule_id_local_date_time_of_day_unique" UNIQUE("care_schedule_id","local_date","time_of_day")
);
--> statement-breakpoint
CREATE TABLE "care_occurrence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"care_item_id" uuid NOT NULL,
	"care_schedule_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"time_of_day" text NOT NULL,
	"last_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "care_occurrence_care_schedule_id_local_date_time_of_day_unique" UNIQUE("care_schedule_id","local_date","time_of_day")
);
--> statement-breakpoint
CREATE TABLE "care_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"care_item_id" uuid NOT NULL,
	"time_of_day" text NOT NULL,
	"repeat_days" integer[] DEFAULT '{}' NOT NULL,
	"week_interval" integer DEFAULT 1 NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"dose_quantity" integer DEFAULT 1 NOT NULL,
	"nag_interval_minutes" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "reminder_occurrence" CASCADE;--> statement-breakpoint
DROP TABLE "reminder_schedule" CASCADE;--> statement-breakpoint
ALTER TABLE "care_item" ADD CONSTRAINT "care_item_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_log" ADD CONSTRAINT "care_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_log" ADD CONSTRAINT "care_log_care_item_id_care_item_id_fk" FOREIGN KEY ("care_item_id") REFERENCES "public"."care_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_log" ADD CONSTRAINT "care_log_care_schedule_id_care_schedule_id_fk" FOREIGN KEY ("care_schedule_id") REFERENCES "public"."care_schedule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_occurrence" ADD CONSTRAINT "care_occurrence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_occurrence" ADD CONSTRAINT "care_occurrence_care_item_id_care_item_id_fk" FOREIGN KEY ("care_item_id") REFERENCES "public"."care_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_occurrence" ADD CONSTRAINT "care_occurrence_care_schedule_id_care_schedule_id_fk" FOREIGN KEY ("care_schedule_id") REFERENCES "public"."care_schedule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_schedule" ADD CONSTRAINT "care_schedule_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_schedule" ADD CONSTRAINT "care_schedule_care_item_id_care_item_id_fk" FOREIGN KEY ("care_item_id") REFERENCES "public"."care_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DROP TYPE "public"."reminder_occurrence_status";