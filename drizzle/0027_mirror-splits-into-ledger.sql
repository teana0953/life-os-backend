ALTER TABLE "finance_transaction" ADD COLUMN "split_expense_id" uuid;--> statement-breakpoint
ALTER TABLE "finance_transaction" ADD COLUMN "category_source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "split_expense" ADD COLUMN "category_name" text;--> statement-breakpoint
ALTER TABLE "finance_transaction" ADD CONSTRAINT "finance_transaction_split_expense_id_split_expense_id_fk" FOREIGN KEY ("split_expense_id") REFERENCES "public"."split_expense"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_transaction_user_split_expense_idx" ON "finance_transaction" USING btree ("user_id","split_expense_id") WHERE split_expense_id is not null;