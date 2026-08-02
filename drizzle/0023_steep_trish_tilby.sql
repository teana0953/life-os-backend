CREATE TABLE "expense_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_group_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_group_member_group_id_user_id_unique" UNIQUE("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "split_expense" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid,
	"payer_user_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"description" text NOT NULL,
	"day" date NOT NULL,
	"split_mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "split_expense_amount_positive" CHECK (amount > 0)
);
--> statement-breakpoint
CREATE TABLE "split_share" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	CONSTRAINT "split_share_expense_id_user_id_unique" UNIQUE("expense_id","user_id"),
	CONSTRAINT "split_share_amount_non_negative" CHECK (amount >= 0)
);
--> statement-breakpoint
ALTER TABLE "expense_group" ADD CONSTRAINT "expense_group_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_group_member" ADD CONSTRAINT "expense_group_member_group_id_expense_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."expense_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_group_member" ADD CONSTRAINT "expense_group_member_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_expense" ADD CONSTRAINT "split_expense_group_id_expense_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."expense_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_expense" ADD CONSTRAINT "split_expense_payer_user_id_users_id_fk" FOREIGN KEY ("payer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_expense" ADD CONSTRAINT "split_expense_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_share" ADD CONSTRAINT "split_share_expense_id_split_expense_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."split_expense"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_share" ADD CONSTRAINT "split_share_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_group_member_user_idx" ON "expense_group_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "split_expense_group_idx" ON "split_expense" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "split_expense_payer_idx" ON "split_expense" USING btree ("payer_user_id");--> statement-breakpoint
CREATE INDEX "split_share_user_idx" ON "split_share" USING btree ("user_id");