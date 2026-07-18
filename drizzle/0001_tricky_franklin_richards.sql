CREATE TYPE "public"."food_entry_source" AS ENUM('manual', 'ai_photo', 'dict');--> statement-breakpoint
CREATE TABLE "daily_target" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"base_staple" numeric NOT NULL,
	"base_meat" numeric NOT NULL,
	"base_fruit" numeric NOT NULL,
	"base_veg" numeric NOT NULL,
	"bonus_staple" numeric DEFAULT '0' NOT NULL,
	"bonus_meat" numeric DEFAULT '0' NOT NULL,
	"bonus_fruit" numeric DEFAULT '0' NOT NULL,
	"bonus_veg" numeric DEFAULT '0' NOT NULL,
	CONSTRAINT "daily_target_user_id_day_unique" UNIQUE("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "food_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"meal" text NOT NULL,
	"name" text,
	"photo_ref" text,
	"source" "food_entry_source" NOT NULL,
	"unclassified" boolean DEFAULT false NOT NULL,
	"carb_g" numeric NOT NULL,
	"protein_g" numeric NOT NULL,
	"fat_g" numeric NOT NULL,
	"sugar_g" numeric NOT NULL,
	"fiber_g" numeric NOT NULL,
	"kcal" numeric NOT NULL,
	"staple" numeric NOT NULL,
	"meat" numeric NOT NULL,
	"fruit" numeric NOT NULL,
	"veg" numeric NOT NULL,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_favorite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"food_item_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_favorite_user_id_food_item_id_unique" UNIQUE("user_id","food_item_id")
);
--> statement-breakpoint
CREATE TABLE "food_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"name" text NOT NULL,
	"carb_g" numeric NOT NULL,
	"protein_g" numeric NOT NULL,
	"fat_g" numeric NOT NULL,
	"sugar_g" numeric NOT NULL,
	"fiber_g" numeric NOT NULL,
	"kcal" numeric NOT NULL,
	"staple" numeric NOT NULL,
	"meat" numeric NOT NULL,
	"fruit" numeric NOT NULL,
	"veg" numeric NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_target" ADD CONSTRAINT "daily_target_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_entry" ADD CONSTRAINT "food_entry_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_favorite" ADD CONSTRAINT "food_favorite_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_favorite" ADD CONSTRAINT "food_favorite_food_item_id_food_item_id_fk" FOREIGN KEY ("food_item_id") REFERENCES "public"."food_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_item" ADD CONSTRAINT "food_item_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;