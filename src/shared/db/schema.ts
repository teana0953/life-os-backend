import { boolean, date, numeric, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  firebaseUid: text("firebase_uid").notNull().unique(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const foodEntrySource = pgEnum("food_entry_source", ["manual", "ai_photo", "dict"]);

export const foodMeasureUnit = pgEnum("food_measure_unit", ["g", "ml"]);

// Shared atomic-nutrient columns for food_item and meal_item (both axes: D1 in design.md).
const nutrientColumns = {
  carbG: numeric("carb_g").notNull(),
  proteinG: numeric("protein_g").notNull(),
  fatG: numeric("fat_g").notNull(),
  sugarG: numeric("sugar_g").notNull(),
  fiberG: numeric("fiber_g").notNull(),
  kcal: numeric("kcal").notNull(),
};

const portionColumns = {
  staple: numeric("staple").notNull(),
  meat: numeric("meat").notNull(),
  fruit: numeric("fruit").notNull(),
  veg: numeric("veg").notNull(),
};

export const foodItem = pgTable("food_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: uuid("owner_user_id").references(() => users.id),
  name: text("name").notNull(),
  ...nutrientColumns,
  ...portionColumns,
  baseAmount: numeric("base_amount"),
  measureUnit: foodMeasureUnit("measure_unit"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const foodFavorite = pgTable(
  "food_favorite",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    foodItemId: uuid("food_item_id")
      .notNull()
      .references(() => foodItem.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.foodItemId)],
);

export const mealEntry = pgTable(
  "meal_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    day: date("day").notNull(),
    meal: text("meal").notNull(),
    time: timestamp("time", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.day, t.meal)],
);

// meal_item stores per-unit portions + nutrients (the amount for quantity = 1);
// the consumed amount (per-unit x quantity) is derived on read, never stored (D3).
export const mealItem = pgTable("meal_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  mealEntryId: uuid("meal_entry_id")
    .notNull()
    .references(() => mealEntry.id, { onDelete: "cascade" }),
  foodItemId: uuid("food_item_id").references(() => foodItem.id, { onDelete: "set null" }),
  name: text("name"),
  photoRef: text("photo_ref"),
  source: foodEntrySource("source").notNull(),
  unclassified: boolean("unclassified").notNull().default(false),
  ...nutrientColumns,
  ...portionColumns,
  quantity: numeric("quantity").notNull().default("1"),
  baseAmount: numeric("base_amount"),
  measureUnit: foodMeasureUnit("measure_unit"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dailyTarget = pgTable(
  "daily_target",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    day: date("day").notNull(),
    baseStaple: numeric("base_staple").notNull(),
    baseMeat: numeric("base_meat").notNull(),
    baseFruit: numeric("base_fruit").notNull(),
    baseVeg: numeric("base_veg").notNull(),
    bonusStaple: numeric("bonus_staple").notNull().default("0"),
    bonusMeat: numeric("bonus_meat").notNull().default("0"),
    bonusFruit: numeric("bonus_fruit").notNull().default("0"),
    bonusVeg: numeric("bonus_veg").notNull().default("0"),
  },
  (t) => [unique().on(t.userId, t.day)],
);
