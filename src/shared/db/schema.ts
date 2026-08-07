import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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

export const foodItem = pgTable(
  "food_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    name: text("name").notNull(),
    ...nutrientColumns,
    ...portionColumns,
    baseAmount: numeric("base_amount"),
    measureUnit: text("measure_unit"),
    // Set for seed-created rows, null for administrator-created shared items
    // and users' custom items; it is the seed's identity key and never
    // changes when `name` is corrected. Intentionally NOT surfaced on the
    // FoodItem domain type: nothing in domain/application reads it, and
    // toDomain's whitelist mapping already ignores it (task 3.3).
    seedKey: text("seed_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("food_item_seed_key_idx").on(t.seedKey).where(sql`seed_key is not null`)],
);

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
      // the link). This also lets the seed's explicit --force refresh (delete +
      // reinsert every shared item; NOT the default seed behavior, which only
      // inserts missing rows — D11 in add-admin-shared-food-editing/design.md)
      // run without a foreign-key violation from favorites still pointing at
      // the old rows.
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

// finance_category: per-user expense/income categories (add-finance-ledger
// design.md). The unique index doubles as the concurrency guard for lazy
// per-user default seeding (`ensureDefaultCategories`): concurrent seed
// attempts race an `onConflictDoNothing` on (user_id, type, name) rather than
// double-inserting.
export const financeCategory = pgTable(
  "finance_category",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    type: text("type").notNull(),
    icon: text("icon").notNull().default("other"),
    sortOrder: integer("sort_order").notNull().default(0),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("finance_category_user_type_name_idx").on(t.userId, t.type, t.name)],
);

// finance_transaction: a single expense/income record. `amount` is a positive
// integer in the currency's minor-or-natural unit (TWD in 元, USD in cents —
// design.md). `day` follows the mealEntry.day convention (a date, not a
// timestamp).
export const financeTransaction = pgTable(
  "finance_transaction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    type: text("type").notNull(),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => financeCategory.id),
    day: date("day").notNull(),
    note: text("note"),
    // Set only by the split mirror write path, never from a request body
    // (design.md D17): a client that could set or clear it would be able to
    // attach its own transaction to someone's split, or unlock a mirror.
    // `on delete cascade` is what removes the mirrors when the split expense
    // goes — a database guarantee rather than an application one, since the
    // deleting user is not the owner of the rows being deleted (D5).
    // Forward-referencing `splitExpense`, defined further down, is safe:
    // drizzle resolves the reference thunk lazily, not at table-build time.
    splitExpenseId: uuid("split_expense_id").references(() => splitExpense.id, { onDelete: "cascade" }),
    // 'mirror' = the category was resolved automatically from the split's
    // category name; 'manual' = the owner picked it themselves and a later
    // split edit must not overwrite it (D6). Defaults to 'manual' so an
    // ordinary user-created transaction is never treated as overwritable.
    categorySource: text("category_source").notNull().default("manual"),
    // The instalment plan this row was generated by, or null for the vast
    // majority of transactions (add-installments design.md D2). `on delete
    // cascade`: deleting a plan removes every instalment it wrote (D6.1) — a
    // database guarantee, since none of the plan write paths ever delete the
    // plan row themselves. Forward-referencing `financeInstallmentPlan`,
    // defined further down, the same way `splitExpenseId` above
    // forward-references `splitExpense` — drizzle resolves the thunk lazily.
    planId: uuid("plan_id").references(() => financeInstallmentPlan.id, { onDelete: "cascade" }),
    // 1-based position within its plan; null off a plan, and also null for
    // the single settlement transaction an early payoff inserts — it is not
    // "the Nth of N", so it is deliberately not numbered as one (design.md D6,
    // tasks 5.3).
    //
    // Also reused, independently of `plan_id`, by a split-mirror row that is
    // one period of a share's repayment schedule (split-installments
    // proposal.md) — 1-based there too, null for an ordinary lump mirror.
    // The two uses never collide: a plan-generated row always has
    // `split_expense_id is null` and a split-mirror row always has
    // `plan_id is null`.
    installmentNo: integer("installment_no"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("finance_transaction_user_day_idx").on(t.userId, t.day),
    // Backs both `listInstallments` and the plan-scoped DELETE that clears
    // upcoming instalments (design.md D3b).
    index("finance_transaction_plan_idx").on(t.planId),
    // At most one mirror per (user, split expense, period) — the identity key
    // an edit upserts on. It cannot be the share id: an edit deletes every
    // share and reinserts them, so share ids change on every edit (D5).
    //
    // split-installments tasks 0.1/5.1: a share on a repayment schedule
    // writes one mirror per period, so "one row per (user, split expense)"
    // stopped holding — the identity key gained `installment_no`. Two
    // partial indexes, not a plain 3-column one, the same way
    // `finance_budget`'s two partial indexes avoid a nullable column
    // breaking a plain unique constraint (NULLs don't collide under standard
    // Postgres uniqueness, and an ordinary lump mirror's `installment_no` is
    // null): one arbitrates the lump case, the other the scheduled case.
    // Each predicate must be repeated in the matching `ON CONFLICT` target,
    // the same way `finance_budget`'s are matched with `targetWhere`.
    uniqueIndex("finance_transaction_split_mirror_lump_idx")
      .on(t.userId, t.splitExpenseId)
      .where(sql`split_expense_id is not null and installment_no is null`),
    uniqueIndex("finance_transaction_split_mirror_period_idx")
      .on(t.userId, t.splitExpenseId, t.installmentNo)
      .where(sql`split_expense_id is not null and installment_no is not null`),
    // A row comes from at most one origin: a plan, a split mirror, or neither
    // (the ordinary case — most transactions the user typed in themselves).
    //
    // **Not** `(plan_id is null) <> (split_expense_id is null)`, which is a
    // strict XOR and therefore rejects every ordinary transaction, both
    // columns being null. `not (both are non-null)` is the rule actually
    // wanted, and it is what makes `installment_no`'s dual meaning safe: the
    // column numbers a bank instalment when `plan_id` is set and a repayment
    // period when `split_expense_id` is, and this is what stops a row ever
    // being both at once.
    check(
      "finance_transaction_plan_split_not_both",
      sql`num_nonnulls(plan_id, split_expense_id) <= 1`,
    ),
  ],
);

// finance_installment_plan: an instalment plan (add-installments design.md
// D2) — a fixed-count, real-charge monthly schedule. This row records HOW its
// instalments were generated (mode/periods/start day/creation-time amount);
// it is NOT an accounting invariant. "amount = sum of its instalments" is
// deliberately not maintained once a single instalment is edited or deleted
// (D2b) — every money computation reads `finance_transaction` rows, never
// this one. `mode` distinguishes the two creation paths (D0/D2): 'total' =
// the user gave a total and the system divided it (credit card); 'per_installment'
// = the user copied the bank's per-instalment figure and it is used exactly
// as given, never divided (subscription/loan).
export const financeInstallmentPlan = pgTable("finance_installment_plan", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  mode: text("mode").notNull(),
  periods: integer("periods").notNull(),
  startDay: date("start_day").notNull(),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull(),
  categoryId: uuid("category_id")
    .notNull()
    .references(() => financeCategory.id),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// finance_budget: per-user recurring monthly budget (add-finance-budgets
// design.md), TWD only. `category_id` null = the user's overall budget (at
// most one); non-null = a per-category budget (at most one per category, and
// only for expense categories). The two partial unique indexes enforce both
// "at most one" rules without a nullable column breaking a plain unique
// constraint (NULLs don't collide under standard Postgres uniqueness).
export const financeBudget = pgTable(
  "finance_budget",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    categoryId: uuid("category_id").references(() => financeCategory.id),
    amount: integer("amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("finance_budget_user_category_idx").on(t.userId, t.categoryId).where(sql`category_id is not null`),
    uniqueIndex("finance_budget_user_overall_idx").on(t.userId).where(sql`category_id is null`),
  ],
);

// finance_budget_alert: dedup record for one (budget, month, threshold) —
// inserted via onConflictDoNothing so a push is only ever sent when the
// insert wins, including under concurrent writes (design.md).
export const financeBudgetAlert = pgTable(
  "finance_budget_alert",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => financeBudget.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    threshold: integer("threshold").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.budgetId, t.month, t.threshold)],
);

// finance_networth_account: a per-user net-worth account (add-finance-networth
// design.md). `kind` is a fixed macro-class (asset|liability, immutable after
// creation); `name` is user-chosen (e.g. 台幣活存/股票/學貸). `archived` is a
// soft-disable: an archived account rejects new snapshots but keeps its history
// readable. Names are unique within a user's same kind.
export const financeNetworthAccount = pgTable(
  "finance_networth_account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("finance_networth_account_user_kind_name_idx").on(t.userId, t.kind, t.name)],
);

// finance_networth_snapshot: one market-value snapshot per account per month
// (`YYYY-MM`), a non-negative TWD integer where both assets and liabilities are
// stored as positive amounts (net worth subtracts the liability sum). Writing a
// snapshot for an existing (account, month) overwrites it (upsert on the
// (account_id, month) unique index). Deleting an account cascades its snapshots.
export const financeNetworthSnapshot = pgTable(
  "finance_networth_snapshot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => financeNetworthAccount.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    value: integer("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("finance_networth_snapshot_account_month_idx").on(t.accountId, t.month)],
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

// friendship: one row per pair of friends (add-friends/design.md). The pair is
// normalized so `user_a_id < user_b_id` (compared as lowercase canonical UUID
// strings, the only form where Postgres' uuid byte order and JS string order
// agree), which the unique index turns into "a pair can only exist once,
// whichever direction the invite went". The CHECK is the DB-level backstop so
// normalization never rests on application discipline alone. `listFriends`
// matches both columns, so the `user_b_id` half needs its own index (the
// unique index only covers a leading `user_a_id`).
export const friendship = pgTable(
  "friendship",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userAId: uuid("user_a_id")
      .notNull()
      .references(() => users.id),
    userBId: uuid("user_b_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.userAId, t.userBId),
    index("friendship_user_b_idx").on(t.userBId),
    check("friendship_normalized_pair", sql`user_a_id < user_b_id`),
  ],
);

// expense_group: a named group for splitting expenses among more than two
// people over time (add-split-bills/design.md). Not deleted, only archived —
// its expenses are other members' financial history.
export const expenseGroup = pgTable("expense_group", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdByUserId: uuid("created_by_user_id")
    .notNull()
    .references(() => users.id),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// expense_group_member: who belongs to a group. Leaving is not supported yet
// (design.md) — membership only ever grows. The `user_id` index is what "my
// groups" (listForUser) relies on; without it that query is a seq scan.
export const expenseGroupMember = pgTable(
  "expense_group_member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => expenseGroup.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.groupId, t.userId), index("expense_group_member_user_idx").on(t.userId)],
);

// split_expense: one split bill. `group_id` null = a groupless/one-off split
// between the people named in its shares. `amount` is the currency's minor
// unit, same convention as finance_transaction. `split_mode` records how the
// caller originally entered it (equal/exact) purely so an edit can default
// back to that input mode — the shares actually owed are always the
// `split_share` rows, never recomputed on read (design.md). The CHECK is the
// DB-level backstop for "amount > 0", the same role `friendship`'s CHECK
// plays for its normalized-pair invariant.
export const splitExpense = pgTable(
  "split_expense",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id").references(() => expenseGroup.id),
    payerUserId: uuid("payer_user_id")
      .notNull()
      .references(() => users.id),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    description: text("description").notNull(),
    day: date("day").notNull(),
    splitMode: text("split_mode").notNull(),
    // The finance category this split should land on in every participant's
    // ledger — a *name*, not an id, because finance categories are per-user:
    // the payer's id means nothing to the other participants, and they are
    // the ones who have to read it (design.md D1). Null = the payer picked
    // none, and each mirror falls back to that holder's own 其他.
    categoryName: text("category_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("split_expense_group_idx").on(t.groupId),
    index("split_expense_payer_idx").on(t.payerUserId),
    check("split_expense_amount_positive", sql`amount > 0`),
  ],
);

// split_share: one participant's owed amount on a split_expense. Cascades on
// the expense's deletion. `sum(amount) = split_expense.amount` is an
// invariant application must guarantee (it spans rows, so no CHECK can
// express it) — see design.md for the single-batch write that keeps it from
// ever landing half-written. The `user_id` index is the main entry point for
// balance queries.
export const splitShare = pgTable(
  "split_share",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => splitExpense.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    amount: integer("amount").notNull(),
  },
  (t) => [
    unique().on(t.expenseId, t.userId),
    index("split_share_user_idx").on(t.userId),
    check("split_share_amount_non_negative", sql`amount >= 0`),
  ],
);

// split_settlement: a repayment recorded as its own kind of record — who paid
// whom, how much, in which currency, on which day, optionally within a group
// (add-settle-up/design.md). Never a reversed expense. `group_id` nullable,
// symmetric with split_expense: a repayment can happen inside a group or
// one-off between friends. The CHECKs are the DB-level backstop: amount > 0
// mirrors split_expense's, and from_user_id <> to_user_id blocks "paid
// myself", which is not a repayment.
export const splitSettlement = pgTable(
  "split_settlement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id").references(() => expenseGroup.id),
    fromUserId: uuid("from_user_id")
      .notNull()
      .references(() => users.id),
    toUserId: uuid("to_user_id")
      .notNull()
      .references(() => users.id),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    day: date("day").notNull(),
    note: text("note"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("split_settlement_from_idx").on(t.fromUserId),
    index("split_settlement_to_idx").on(t.toUserId),
    index("split_settlement_group_idx").on(t.groupId),
    check("split_settlement_amount_positive", sql`amount > 0`),
    check("split_settlement_not_self", sql`from_user_id <> to_user_id`),
  ],
);

// split_activity: one entry in the split-bills timeline — who did what, when.
// It exists for the two changes that today leave nothing behind: a deleted
// expense and an edited amount (add-split-activity/design.md D1).
//
// **Every column here is a snapshot, and deliberately denormalized.** There is
// no foreign key to `split_expense`/`split_settlement`, because those rows are
// exactly the ones that disappear — `subject_id` is a bare uuid, and an entry
// about a deleted expense keeps its own `amount`/`currency`/`description` so it
// stays readable afterwards. `group_id` *does* get a foreign key: groups are
// only ever archived, never deleted (`ExpenseGroupRepository` has no delete),
// so that reference can never dangle — which is also why the group's name is
// joined at read time rather than frozen here (D2: freeze what cascades away,
// join what persists). Same for `actor_user_id`/`counterpart_user_id`.
//
// Structured columns rather than one `jsonb` blob (tasks 1.2): the schema's
// existing jsonb precedent (`vitals.bp_readings`) is a *list* of repeated
// sub-records that nothing filters on, whereas these are a fixed handful of
// scalars — and one of them, `audience_user_ids`, has to be reachable from the
// visibility WHERE clause, which is the whole point of the table.
//
// `audience_user_ids` is the frozen audience of a **groupless** entry, and it
// is correctness, not an optimization: a groupless expense's participants live
// in `split_share`, which cascades away with the expense, so after a deletion
// there is no other way to know who the entry was for. A grouped entry stores
// NULL and is shown to the group's *current* members instead, matching how
// `listForUser` already decides group visibility. The CHECK pins that XOR: an
// entry with neither is invisible to everyone (a silently lost change), one
// with both has two disagreeing answers.
export const splitActivity = pgTable(
  "split_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    groupId: uuid("group_id").references(() => expenseGroup.id),
    /** The expense/settlement/group this describes. No FK on purpose — the row it names may be gone. */
    subjectId: uuid("subject_id"),
    /** The other person the event is about: a settlement's other party, or the member who was added. */
    counterpartUserId: uuid("counterpart_user_id").references(() => users.id),
    amount: integer("amount"),
    /**
     * Set by every `expense_updated` entry, whether or not the amount moved —
     * an edit that says "modified" with no numbers says nothing (design.md
     * D6), and the reader compares the two. It is NOT a "the amount changed"
     * flag: `previous_amount = amount` is a normal, expected row.
     */
    previousAmount: integer("previous_amount"),
    /**
     * A repayment's direction: true = the actor paid the counterpart, false =
     * the counterpart paid the actor. Without it "you paid Ben 500" and "Ben
     * paid you 500" are the same row, and for a *deleted* settlement the
     * subject row is gone, so nothing can recover it afterwards.
     *
     * Both parties render from this one row (D5 — the entry never says "you"):
     * the actor reads it as written, the counterpart reads it inverted.
     *
     * The CHECK pins it to exactly the two settlement types: a settlement
     * entry with no direction is meaningless, and a direction on a group
     * event has nothing to be the direction *of*. NULL for the other six is
     * therefore an absence, never "unknown" — the write paths (both of which
     * establish the actor is one of the two parties) fail loudly rather than
     * store a direction they had to guess.
     */
    actorIsPayer: boolean("actor_is_payer"),
    currency: text("currency"),
    description: text("description"),
    audienceUserIds: uuid("audience_user_ids").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("split_activity_group_idx").on(t.groupId),
    index("split_activity_created_idx").on(t.createdAt),
    check("split_activity_audience_xor_group", sql`(group_id is null) <> (audience_user_ids is null)`),
    check(
      "split_activity_settlement_has_direction",
      sql`(type in ('settlement_created', 'settlement_deleted')) = (actor_is_payer is not null)`,
    ),
  ],
);

// friend_invite: a single-use, 7-day invite link. Only the token's hash is
// stored (a DB leak is not an invite-link leak); the hash is a deterministic,
// unsalted SHA-256 precisely so `WHERE token_hash = H(token)` and the unique
// index work — the token itself is >=32 random bytes, so no KDF is needed.
// "Used" is `accepted_at IS NOT NULL`, which the accept CTE claims atomically.
export const friendInvite = pgTable(
  "friend_invite",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inviterUserId: uuid("inviter_user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("friend_invite_inviter_idx").on(t.inviterUserId)],
);
