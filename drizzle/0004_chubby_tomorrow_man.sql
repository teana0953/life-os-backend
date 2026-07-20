CREATE TYPE "public"."food_measure_unit" AS ENUM('g', 'ml');--> statement-breakpoint
ALTER TABLE "food_item" RENAME COLUMN "base_grams" TO "base_amount";--> statement-breakpoint
ALTER TABLE "meal_item" RENAME COLUMN "base_grams" TO "base_amount";--> statement-breakpoint
ALTER TABLE "food_item" ADD COLUMN "measure_unit" "food_measure_unit";--> statement-breakpoint
ALTER TABLE "meal_item" ADD COLUMN "measure_unit" "food_measure_unit";--> statement-breakpoint
UPDATE "food_item" SET "measure_unit" = 'g' WHERE "base_amount" IS NOT NULL;--> statement-breakpoint
UPDATE "meal_item" SET "measure_unit" = 'g' WHERE "base_amount" IS NOT NULL;