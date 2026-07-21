ALTER TABLE "food_item" ALTER COLUMN "measure_unit" SET DATA TYPE text USING "measure_unit"::text;--> statement-breakpoint
ALTER TABLE "meal_item" ALTER COLUMN "measure_unit" SET DATA TYPE text USING "measure_unit"::text;--> statement-breakpoint
DROP TYPE "public"."food_measure_unit";