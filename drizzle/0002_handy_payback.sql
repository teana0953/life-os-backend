ALTER TABLE "food_entry" ADD COLUMN "eaten_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "food_item" ADD COLUMN "base_grams" numeric;