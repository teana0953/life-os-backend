CREATE TABLE "finance_budget" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category_id" uuid,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_budget_alert" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"month" text NOT NULL,
	"threshold" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_budget_alert_budget_id_month_threshold_unique" UNIQUE("budget_id","month","threshold")
);
--> statement-breakpoint
ALTER TABLE "finance_budget" ADD CONSTRAINT "finance_budget_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_budget" ADD CONSTRAINT "finance_budget_category_id_finance_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."finance_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_budget_alert" ADD CONSTRAINT "finance_budget_alert_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_budget_alert" ADD CONSTRAINT "finance_budget_alert_budget_id_finance_budget_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."finance_budget"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_budget_user_category_idx" ON "finance_budget" USING btree ("user_id","category_id") WHERE category_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_budget_user_overall_idx" ON "finance_budget" USING btree ("user_id") WHERE category_id is null;