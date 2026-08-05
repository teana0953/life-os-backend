CREATE TABLE "split_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"group_id" uuid,
	"subject_id" uuid,
	"counterpart_user_id" uuid,
	"amount" integer,
	"previous_amount" integer,
	"currency" text,
	"description" text,
	"audience_user_ids" uuid[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "split_activity_audience_xor_group" CHECK ((group_id is null) <> (audience_user_ids is null))
);
--> statement-breakpoint
ALTER TABLE "split_activity" ADD CONSTRAINT "split_activity_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_activity" ADD CONSTRAINT "split_activity_group_id_expense_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."expense_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_activity" ADD CONSTRAINT "split_activity_counterpart_user_id_users_id_fk" FOREIGN KEY ("counterpart_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "split_activity_group_idx" ON "split_activity" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "split_activity_created_idx" ON "split_activity" USING btree ("created_at");