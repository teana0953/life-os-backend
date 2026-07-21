CREATE TABLE "water_intake" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"total_ml" numeric NOT NULL,
	CONSTRAINT "water_intake_user_id_day_unique" UNIQUE("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "water_target" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"target_ml" numeric NOT NULL,
	CONSTRAINT "water_target_user_id_day_unique" UNIQUE("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "water_intake" ADD CONSTRAINT "water_intake_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "water_target" ADD CONSTRAINT "water_target_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;