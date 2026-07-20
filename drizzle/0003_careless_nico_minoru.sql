CREATE TABLE "meal_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"meal" text NOT NULL,
	"time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_entry_user_id_day_meal_unique" UNIQUE("user_id","day","meal")
);
--> statement-breakpoint
CREATE TABLE "meal_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meal_entry_id" uuid NOT NULL,
	"food_item_id" uuid,
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
	"quantity" numeric DEFAULT '1' NOT NULL,
	"base_grams" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "food_entry" CASCADE;--> statement-breakpoint
ALTER TABLE "meal_entry" ADD CONSTRAINT "meal_entry_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_item" ADD CONSTRAINT "meal_item_meal_entry_id_meal_entry_id_fk" FOREIGN KEY ("meal_entry_id") REFERENCES "public"."meal_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_item" ADD CONSTRAINT "meal_item_food_item_id_food_item_id_fk" FOREIGN KEY ("food_item_id") REFERENCES "public"."food_item"("id") ON DELETE set null ON UPDATE no action;