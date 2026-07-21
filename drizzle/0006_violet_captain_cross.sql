ALTER TABLE "food_favorite" DROP CONSTRAINT "food_favorite_food_item_id_food_item_id_fk";
--> statement-breakpoint
ALTER TABLE "food_favorite" ADD CONSTRAINT "food_favorite_food_item_id_food_item_id_fk" FOREIGN KEY ("food_item_id") REFERENCES "public"."food_item"("id") ON DELETE cascade ON UPDATE no action;