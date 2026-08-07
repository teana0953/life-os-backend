CREATE TABLE "finance_installment_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"periods" integer NOT NULL,
	"start_day" date NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"category_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_transaction" ADD COLUMN "plan_id" uuid;--> statement-breakpoint
ALTER TABLE "finance_transaction" ADD COLUMN "installment_no" integer;--> statement-breakpoint
ALTER TABLE "finance_installment_plan" ADD CONSTRAINT "finance_installment_plan_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_installment_plan" ADD CONSTRAINT "finance_installment_plan_category_id_finance_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."finance_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transaction" ADD CONSTRAINT "finance_transaction_plan_id_finance_installment_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."finance_installment_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finance_transaction_plan_idx" ON "finance_transaction" USING btree ("plan_id");