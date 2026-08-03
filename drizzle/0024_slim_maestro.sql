CREATE TABLE "split_settlement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"day" date NOT NULL,
	"note" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "split_settlement_amount_positive" CHECK (amount > 0),
	CONSTRAINT "split_settlement_not_self" CHECK (from_user_id <> to_user_id)
);
--> statement-breakpoint
ALTER TABLE "split_settlement" ADD CONSTRAINT "split_settlement_group_id_expense_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."expense_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_settlement" ADD CONSTRAINT "split_settlement_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_settlement" ADD CONSTRAINT "split_settlement_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_settlement" ADD CONSTRAINT "split_settlement_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "split_settlement_from_idx" ON "split_settlement" USING btree ("from_user_id");--> statement-breakpoint
CREATE INDEX "split_settlement_to_idx" ON "split_settlement" USING btree ("to_user_id");--> statement-breakpoint
CREATE INDEX "split_settlement_group_idx" ON "split_settlement" USING btree ("group_id");