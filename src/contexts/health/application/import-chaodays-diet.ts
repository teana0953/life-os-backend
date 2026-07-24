import { parseGlucoseReadings, stripGlucoseText } from "../domain/chaodays-diet-parse";
import type { ChaodaysClient, ChaodaysDietRecord } from "../domain/chaodays-client";
import { portionsToNutrients } from "../domain/conversion";
import type { MealEntry } from "../domain/meal-entry";
import type { CreateMealEntryInput, CreateMealItemForEntryInput, CreateMealItemInput, MealRepository } from "../domain/meal-repository";
import type { GlucoseReading, VitalsRecord } from "../domain/vitals";
import type { SetVitalsInput, VitalsRepository } from "../domain/vitals-repository";

export interface ImportChaodaysDietInput {
  userId: string;
  uid: string;
  password: string;
  /** ISO calendar date, e.g. "2026-07-18". */
  from: string;
  to: string;
}

export interface ImportChaodaysDietSummary {
  mealsImported: number;
  mealsSkipped: number;
  glucoseImported: number;
  from: string;
  to: string;
}

const MEAL_NAME_BY_RECORD_TYPE: Record<"breakfast" | "lunch" | "dinner", string> = {
  breakfast: "breakfast",
  lunch: "lunch",
  dinner: "dinner",
};

/** Base name for a snack meal; multiple snacks in a day are named this, then this+2, this+3, ... */
const SNACK_WORD = "點心";

/** chaodays is a Taiwan app; `recorded_at` is wall-clock at this fixed offset. */
const CHAODAYS_TZ_OFFSET = "+08:00";

/** `"YYYY-MM-DD HH:mm"` -> `"HH:mm"`. */
function timeOfDay(recordedAt: string): string {
  return recordedAt.slice(11, 16);
}

/** Dedup key for a glucose reading, per design: same time+value+mealContext+label are the same reading. */
function glucoseKey(reading: GlucoseReading): string {
  return `${reading.time}|${reading.value}|${reading.mealContext}|${reading.label}`;
}

/**
 * The next snack name in a day's series (mirrors the frontend's
 * `nextSnackName` in `snack_naming.dart`, specialized to the backend's fixed
 * `SNACK_WORD`): the base word alone if none of `existingSnackNames` match
 * `^點心(\d+)?$`, otherwise the base word followed by one more than the
 * highest number seen (a bare base word counts as 1) — so a new snack can't
 * collide with an existing one even after an earlier one was deleted.
 */
export function nextSnackName(existingSnackNames: string[]): string {
  const pattern = new RegExp(`^${SNACK_WORD}(\\d+)?$`);
  let maxNumber: number | null = null;
  for (const name of existingSnackNames) {
    const match = pattern.exec(name);
    if (!match) continue;
    const number = match[1] === undefined ? 1 : Number(match[1]);
    if (maxNumber === null || number > maxNumber) maxNumber = number;
  }
  return maxNumber === null ? SNACK_WORD : `${SNACK_WORD}${maxNumber + 1}`;
}

/** Parses a chaodays `recorded_at` at the +08:00 offset; falls back to the day's start (also at +08:00) if malformed. */
function parseRecordTime(recordedAt: string, day: string): Date {
  const parsed = new Date(`${recordedAt.replace(" ", "T")}:00${CHAODAYS_TZ_OFFSET}`);
  return Number.isNaN(parsed.getTime()) ? new Date(`${day}T00:00:00${CHAODAYS_TZ_OFFSET}`) : parsed;
}

/** Every glucose reading parsed out of `records`' item names, each tagged with its own record's time. */
function collectGlucoseReadings(records: ChaodaysDietRecord[]): GlucoseReading[] {
  const readings: GlucoseReading[] = [];
  for (const record of records) {
    const time = timeOfDay(record.recordedAt);
    for (const item of record.items) {
      readings.push(...parseGlucoseReadings(item.name, time));
    }
  }
  return readings;
}

/** Builds the (portion > 0 only) meal items merged from `records`. */
function buildMealItems(records: ChaodaysDietRecord[]): CreateMealItemInput[] {
  const mealItems: CreateMealItemInput[] = [];
  for (const record of records) {
    for (const item of record.items) {
      if (item.staple <= 0 && item.meat <= 0 && item.fruit <= 0 && item.veg <= 0) continue;
      const portions = { staple: item.staple, meat: item.meat, fruit: item.fruit, veg: item.veg };
      const name = stripGlucoseText(item.name);
      mealItems.push({
        foodItemId: null,
        name: name === "" ? null : name,
        photoRef: null,
        source: "manual",
        unclassified: false,
        ...portionsToNutrients(portions),
        ...portions,
        quantity: 1,
        baseAmount: null,
        measureUnit: null,
      });
    }
  }
  return mealItems;
}

/**
 * Use case: sign in to chaodays, pull diet records for `[from, to]`, and:
 * - import each day's standard-meal (breakfast/lunch/dinner) food items
 *   (portion > 0 only) into one merged meal per (day, code), skipping (once)
 *   a code that already existed before this import (judged from a snapshot
 *   taken before writing anything) — so multiple same-type chaodays records
 *   on a day merge into one meal;
 * - import each day's `extra` (snack) records as one meal per distinct
 *   `recorded_at` time (same-time records merge), named by the app's
 *   snack rule (點心, 點心2, ...); a time already present in the snapshot is
 *   skipped, so re-importing the same range adds no duplicate snacks;
 * - extract blood-glucose free text out of every item's name (regardless of
 *   whether its meal is skipped) and merge it into that day's vitals,
 *   de-duplicated against existing readings and preserving the day's other
 *   vitals fields.
 *
 * To keep the number of DB round-trips independent of the date range (Neon
 * HTTP issues one subrequest per statement, and Workers cap subrequests per
 * invocation), existing meals/vitals for the whole range are read once each,
 * everything is computed in memory, and all writes are persisted via one
 * batched `createMeals` call and one batched `setMany` call.
 */
export async function importChaodaysDiet(
  mealRepository: MealRepository,
  vitalsRepository: VitalsRepository,
  chaodaysClient: ChaodaysClient,
  input: ImportChaodaysDietInput,
): Promise<ImportChaodaysDietSummary> {
  const session = await chaodaysClient.signIn(input.uid, input.password);
  const { records } = await chaodaysClient.fetchDietRecords(session, input.from, input.to);

  const recordsByDay = new Map<string, ChaodaysDietRecord[]>();
  for (const record of records) {
    const list = recordsByDay.get(record.date) ?? [];
    list.push(record);
    recordsByDay.set(record.date, list);
  }

  // Reads for the whole range happen once each, before any writes.
  const existingMeals = await mealRepository.listMealsInRange(input.userId, input.from, input.to);
  const preexistingMealsByDay = new Map<string, Set<string>>();
  // Snacks (extra records) key idempotency by time rather than name, and need
  // the day's existing snack names to continue the 點心/點心2/... numbering —
  // both derived from the existing meals whose name isn't a standard code.
  const existingSnacksByDay = new Map<string, MealEntry[]>();
  for (const meal of existingMeals) {
    const set = preexistingMealsByDay.get(meal.day) ?? new Set<string>();
    set.add(meal.meal);
    preexistingMealsByDay.set(meal.day, set);

    if (meal.meal in MEAL_NAME_BY_RECORD_TYPE) continue;
    const snacks = existingSnacksByDay.get(meal.day) ?? [];
    snacks.push(meal);
    existingSnacksByDay.set(meal.day, snacks);
  }

  const existingVitalsRecords = await vitalsRepository.listRange(input.userId, input.from, input.to);
  const existingVitalsByDay = new Map<string, VitalsRecord>();
  for (const record of existingVitalsRecords) {
    existingVitalsByDay.set(record.day, record);
  }

  let mealsImported = 0;
  let mealsSkipped = 0;
  let glucoseImported = 0;

  const entries: CreateMealEntryInput[] = [];
  const items: CreateMealItemForEntryInput[] = [];
  const vitalsRows: SetVitalsInput[] = [];

  for (const [day, dayRecords] of recordsByDay) {
    const preexistingMeals = preexistingMealsByDay.get(day) ?? new Set<string>();
    const existingSnacks = existingSnacksByDay.get(day) ?? [];
    const existingSnackTimes = new Set(existingSnacks.map((meal) => meal.time.getTime()));
    // Grows as new snacks are named this day, so numbering stays unique within the import.
    const snackNamesSoFar = existingSnacks.map((meal) => meal.meal);

    const standardRecordsByMeal = new Map<string, ChaodaysDietRecord[]>();
    const extraRecordsByTime = new Map<string, ChaodaysDietRecord[]>();
    for (const record of dayRecords) {
      if (record.recordType === "extra") {
        const list = extraRecordsByTime.get(record.recordedAt) ?? [];
        list.push(record);
        extraRecordsByTime.set(record.recordedAt, list);
        continue;
      }
      const meal = MEAL_NAME_BY_RECORD_TYPE[record.recordType];
      // Defensive: an unrecognized chaodays record_type has no lifeos meal name;
      // skip it rather than write a meal with an undefined name.
      if (meal === undefined) continue;
      const list = standardRecordsByMeal.get(meal) ?? [];
      list.push(record);
      standardRecordsByMeal.set(meal, list);
    }

    const newGlucoseReadings: GlucoseReading[] = [];

    // Standard meals: one merged meal per (day, code), skipping a code that pre-existed.
    for (const [meal, mealRecords] of standardRecordsByMeal) {
      newGlucoseReadings.push(...collectGlucoseReadings(mealRecords));

      if (preexistingMeals.has(meal)) {
        mealsSkipped++;
        continue;
      }

      const mealItems = buildMealItems(mealRecords);
      if (mealItems.length === 0) continue;

      const time = parseRecordTime(mealRecords[0].recordedAt, day);
      const mealEntryId = crypto.randomUUID();
      entries.push({ id: mealEntryId, userId: input.userId, day, meal, time });
      for (const item of mealItems) {
        items.push({ ...item, mealEntryId });
      }
      mealsImported++;
    }

    // Snacks (extra records): one meal per distinct recorded_at time, ordered
    // ascending so a clean import's names track chronological order. A time
    // already present in the existing-meals snapshot is skipped (idempotent
    // re-import); a new time gets the next 點心/點心2/... name.
    const snackTimesAscending = [...extraRecordsByTime.keys()].sort();
    for (const recordedAt of snackTimesAscending) {
      const mealRecords = extraRecordsByTime.get(recordedAt)!;
      newGlucoseReadings.push(...collectGlucoseReadings(mealRecords));

      const time = parseRecordTime(recordedAt, day);
      if (existingSnackTimes.has(time.getTime())) {
        mealsSkipped++;
        continue;
      }

      const mealItems = buildMealItems(mealRecords);
      if (mealItems.length === 0) continue;

      const meal = nextSnackName(snackNamesSoFar);
      snackNamesSoFar.push(meal);

      const mealEntryId = crypto.randomUUID();
      entries.push({ id: mealEntryId, userId: input.userId, day, meal, time });
      for (const item of mealItems) {
        items.push({ ...item, mealEntryId });
      }
      mealsImported++;
    }

    const existingVitals = existingVitalsByDay.get(day) ?? null;
    const existingGlucose = existingVitals?.glucoseReadings ?? [];
    const existingKeys = new Set(existingGlucose.map(glucoseKey));
    const glucoseToAppend: GlucoseReading[] = [];
    for (const reading of newGlucoseReadings) {
      const key = glucoseKey(reading);
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      glucoseToAppend.push(reading);
    }

    if (glucoseToAppend.length > 0) {
      vitalsRows.push({
        userId: input.userId,
        day,
        weightKg: existingVitals?.weightKg ?? null,
        bodyFatPct: existingVitals?.bodyFatPct ?? null,
        bpReadings: existingVitals?.bpReadings ?? [],
        glucoseReadings: [...existingGlucose, ...glucoseToAppend],
        spo2Readings: existingVitals?.spo2Readings ?? [],
      });
      glucoseImported += glucoseToAppend.length;
    }
  }

  if (entries.length > 0) await mealRepository.createMeals(entries, items);
  if (vitalsRows.length > 0) await vitalsRepository.setMany(vitalsRows);

  return { mealsImported, mealsSkipped, glucoseImported, from: input.from, to: input.to };
}
