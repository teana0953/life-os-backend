CREATE TABLE "vitals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"weight_kg" numeric,
	"body_fat_pct" numeric,
	"bp_readings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"glucose_readings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"spo2_readings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "vitals_user_id_day_unique" UNIQUE("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "vitals" ADD CONSTRAINT "vitals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;