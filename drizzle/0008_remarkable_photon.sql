CREATE TABLE "bowel_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"count" integer NOT NULL,
	"is_normal" boolean,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "bowel_log_user_id_day_unique" UNIQUE("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "bowel_log" ADD CONSTRAINT "bowel_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;