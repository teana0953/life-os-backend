ALTER TABLE "split_activity" ADD COLUMN "changed_fields" text[];--> statement-breakpoint
ALTER TABLE "split_activity" ADD COLUMN "added_display_names" text[];--> statement-breakpoint
ALTER TABLE "split_activity" ADD COLUMN "removed_display_names" text[];--> statement-breakpoint
ALTER TABLE "split_activity" ADD CONSTRAINT "split_activity_changed_fields_vocabulary" CHECK (changed_fields is null or changed_fields <@ array['amount', 'currency', 'description', 'day', 'payer', 'shares']::text[]);--> statement-breakpoint
ALTER TABLE "split_activity" ADD CONSTRAINT "split_activity_edit_detail_only_on_updates" CHECK (type = 'expense_updated' or (changed_fields is null and added_display_names is null and removed_display_names is null));