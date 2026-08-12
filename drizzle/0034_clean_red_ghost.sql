CREATE TABLE "care_day_instance_pointer" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"local_date" date NOT NULL,
	"instance_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "care_day_instance_pointer" ADD CONSTRAINT "care_day_instance_pointer_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;