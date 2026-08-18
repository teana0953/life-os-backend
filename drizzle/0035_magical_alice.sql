CREATE TABLE "push_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"care_occurrence_id" uuid NOT NULL,
	"push_subscription_id" uuid,
	"token_hash" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"acked_at" timestamp with time zone,
	CONSTRAINT "push_delivery_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "push_delivery" ADD CONSTRAINT "push_delivery_care_occurrence_id_care_occurrence_id_fk" FOREIGN KEY ("care_occurrence_id") REFERENCES "public"."care_occurrence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_delivery" ADD CONSTRAINT "push_delivery_push_subscription_id_push_subscription_id_fk" FOREIGN KEY ("push_subscription_id") REFERENCES "public"."push_subscription"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_delivery_care_occurrence_idx" ON "push_delivery" USING btree ("care_occurrence_id");