CREATE TABLE "body_profile" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"height_cm" numeric,
	"target_weight_kg" numeric,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "body_profile" ADD CONSTRAINT "body_profile_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;