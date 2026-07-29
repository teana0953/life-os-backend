import { boolean, date, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  firebaseUid: text("firebase_uid").notNull().unique(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  // IANA zone used for all reminder time-of-day evaluation (D6b in
  // add-medication-reminders/design.md); defaults to the primary user's zone.
  timezone: text("timezone").notNull().default("Asia/Taipei"),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const foodEntrySource = pgEnum("food_entry_source", ["manual", "ai_photo", "dict"]);

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
  measureUnit: text("measure_unit"),
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
      // A favorite is meaningless once its food item is gone, so cascade-delete
      // it (unlike meal_item, which keeps the historical log row and only nulls
      // the link). This also lets the seed reseed shared items — a delete +
      // reinsert — without a foreign-key violation from favorites still
      // pointing at the old rows.
      .references(() => foodItem.id, { onDelete: "cascade" }),
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
  measureUnit: text("measure_unit"),
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

export const waterIntake = pgTable(
  "water_intake",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    day: date("day").notNull(),
    totalMl: numeric("total_ml").notNull(),
  },
  (t) => [unique().on(t.userId, t.day)],
);

export const waterTarget = pgTable(
  "water_target",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    day: date("day").notNull(),
    targetMl: numeric("target_ml").notNull(),
  },
  (t) => [unique().on(t.userId, t.day)],
);

export const bowelLog = pgTable(
  "bowel_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    day: date("day").notNull(),
    count: integer("count").notNull(),
    isNormal: boolean("is_normal"),
    note: text("note").notNull().default(""),
  },
  (t) => [unique().on(t.userId, t.day)],
);

// exercise_log holds a per-user, per-day *list* of entries (many per day,
// including repeats of the same activity): no unique constraint. activity_id
// references the static in-code library (validated at write time), so there is
// no foreign key here. Reads enrich name/category from that library.
export const exerciseLog = pgTable(
  "exercise_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    day: date("day").notNull(),
    activityId: text("activity_id").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("exercise_log_user_day_idx").on(t.userId, t.day)],
);

// menstrual_period holds a per-user *list* of periods (one row per cycle: a
// required start_date and a nullable end_date set when the period ends). Many
// rows per user, no unique constraint. Cycle statistics are derived on read,
// not stored.
export const menstrualPeriod = pgTable(
  "menstrual_period",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("menstrual_period_user_start_idx").on(t.userId, t.startDate)],
);

// body_profile holds one static-ish row per user: height and target weight
// (both nullable until entered). Upserted by user_id (the primary key).
export const bodyProfile = pgTable("body_profile", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  heightCm: numeric("height_cm"),
  targetWeightKg: numeric("target_weight_kg"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// push_subscription: one row per browser/device Web Push subscription. `endpoint`
// is globally unique to a subscription (D5 in design.md), so subscribing upserts
// on conflict(endpoint) rather than being keyed by user.
export const pushSubscription = pgTable("push_subscription", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vitals = pgTable(
  "vitals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    day: date("day").notNull(),
    weightKg: numeric("weight_kg"),
    bodyFatPct: numeric("body_fat_pct"),
    bpReadings: jsonb("bp_readings")
      .$type<{ systolic: number; diastolic: number; pulse: number | null; time: string }[]>()
      .notNull()
      .default([]),
    glucoseReadings: jsonb("glucose_readings")
      .$type<
        {
          label: string;
          value: number;
          mealContext?: "fasting" | "pre_meal" | "post_meal" | null;
          time: string;
        }[]
      >()
      .notNull()
      .default([]),
    spo2Readings: jsonb("spo2_readings")
      .$type<{ spo2: number; pulse: number | null; time: string }[]>()
      .notNull()
      .default([]),
  },
  (t) => [unique().on(t.userId, t.day)],
);

// care_item: a generic care reminder (medication/rehab/radiotherapy_care/custom
// — add-care-reminders/design.md D1). `category` stays plain text (not a
// Postgres enum) so a new category needs no schema change. `dose`/`stock`/
// `stockAlert` are nullable and only meaningful for `category = medication`.
export const careItem = pgTable("care_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  category: text("category").notNull(),
  title: text("title").notNull(),
  note: text("note"),
  dose: text("dose"),
  stock: integer("stock"),
  stockAlert: integer("stock_alert"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// care_schedule: one time-of-day for a care_item (a care_item has 0..N). Slot
// key for care_log/care_occurrence is `local_date` + `time_of_day` (text), NOT
// a UTC instant (D5 in design.md). `repeatDays` empty = every day (D3).
export const careSchedule = pgTable("care_schedule", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  careItemId: uuid("care_item_id")
    .notNull()
    .references(() => careItem.id, { onDelete: "cascade" }),
  timeOfDay: text("time_of_day").notNull(),
  repeatDays: integer("repeat_days").array().notNull().default([]),
  weekInterval: integer("week_interval").notNull().default(1),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  doseQuantity: integer("dose_quantity").notNull().default(1),
  nagIntervalMinutes: integer("nag_interval_minutes").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const careLogStatus = pgEnum("care_log_status", ["done", "skipped", "missed"]);

// care_log: adherence record for one slot (schedule, local_date, time_of_day —
// unique, so answering/markMissed is an insert-if-absent, never clobbering an
// existing log — D6/D7 in design.md).
export const careLog = pgTable(
  "care_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    careItemId: uuid("care_item_id")
      .notNull()
      .references(() => careItem.id, { onDelete: "cascade" }),
    careScheduleId: uuid("care_schedule_id")
      .notNull()
      .references(() => careSchedule.id, { onDelete: "cascade" }),
    localDate: date("local_date").notNull(),
    timeOfDay: text("time_of_day").notNull(),
    status: careLogStatus("status").notNull(),
    doneTime: timestamp("done_time", { withTimezone: true }),
    doseQuantity: integer("dose_quantity").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.careScheduleId, t.localDate, t.timeOfDay)],
);

// care_occurrence: nag + send state for one slot, unique per slot so a
// repeated/look-back tick never double-fires (D4/D5 in design.md).
// last_notified_at now means "at least one push in that round actually
// succeeded" (D10) — it used to double as "we tried", which is exactly why a
// slot could look delivered while the user received nothing. last_attempt_at /
// last_send_outcome / last_send_detail record every attempt, delivered or not,
// so "never went out" is distinguishable from "the sender said OK" by SQL alone
// (D11-D13). Diagnostic query: last_send_detail IS NOT NULL.
export const careOccurrence = pgTable(
  "care_occurrence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    careItemId: uuid("care_item_id")
      .notNull()
      .references(() => careItem.id, { onDelete: "cascade" }),
    careScheduleId: uuid("care_schedule_id")
      .notNull()
      .references(() => careSchedule.id, { onDelete: "cascade" }),
    localDate: date("local_date").notNull(),
    timeOfDay: text("time_of_day").notNull(),
    lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastSendOutcome: text("last_send_outcome"),
    lastSendDetail: text("last_send_detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.careScheduleId, t.localDate, t.timeOfDay)],
);
