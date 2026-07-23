import { parseGlucoseReadings, stripGlucoseText } from "../domain/chaodays-diet-parse";
import type { ChaodaysClient, ChaodaysDietRecord } from "../domain/chaodays-client";
import { portionsToNutrients } from "../domain/conversion";
import type { CreateMealItemInput, MealRepository } from "../domain/meal-repository";
import type { GlucoseReading } from "../domain/vitals";
import type { VitalsRepository } from "../domain/vitals-repository";

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

const MEAL_NAME_BY_RECORD_TYPE: Record<ChaodaysDietRecord["recordType"], string> = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  extra: "點心",
};

/** `"YYYY-MM-DD HH:mm"` -> `"HH:mm"`. */
function timeOfDay(recordedAt: string): string {
  return recordedAt.slice(11, 16);
}

/** Dedup key for a glucose reading, per design: same time+value+mealContext+label are the same reading. */
function glucoseKey(reading: GlucoseReading): string {
  return `${reading.time}|${reading.value}|${reading.mealContext}|${reading.label}`;
}

/**
 * Use case: sign in to chaodays, pull diet records for `[from, to]`, and:
 * - import each day+meal-type's food items (portion > 0 only) into meals,
 *   skipping (once) any meal type that already existed before this import
 *   (judged from a snapshot taken before writing anything that day) — so
 *   multiple same-type chaodays records on a day merge into one meal;
 * - extract blood-glucose free text out of every item's name (regardless of
 *   whether its meal is skipped) and read-modify-write it into that day's
 *   vitals, de-duplicated against existing readings and preserving the
 *   day's other vitals fields.
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

  let mealsImported = 0;
  let mealsSkipped = 0;
  let glucoseImported = 0;

  for (const [day, dayRecords] of recordsByDay) {
    const preexistingMeals = new Set((await mealRepository.listMealsByDay(input.userId, day)).map((m) => m.meal));

    const recordsByMeal = new Map<string, ChaodaysDietRecord[]>();
    for (const record of dayRecords) {
      const meal = MEAL_NAME_BY_RECORD_TYPE[record.recordType];
      // Defensive: an unrecognized chaodays record_type has no lifeos meal name;
      // skip it rather than write a meal with an undefined name.
      if (meal === undefined) continue;
      const list = recordsByMeal.get(meal) ?? [];
      list.push(record);
      recordsByMeal.set(meal, list);
    }

    const newGlucoseReadings: GlucoseReading[] = [];

    for (const [meal, mealRecords] of recordsByMeal) {
      for (const record of mealRecords) {
        const time = timeOfDay(record.recordedAt);
        for (const item of record.items) {
          newGlucoseReadings.push(...parseGlucoseReadings(item.name, time));
        }
      }

      if (preexistingMeals.has(meal)) {
        mealsSkipped++;
        continue;
      }

      const items: CreateMealItemInput[] = [];
      for (const record of mealRecords) {
        for (const item of record.items) {
          if (item.staple <= 0 && item.meat <= 0 && item.fruit <= 0 && item.veg <= 0) continue;
          const portions = { staple: item.staple, meat: item.meat, fruit: item.fruit, veg: item.veg };
          const name = stripGlucoseText(item.name);
          items.push({
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

      if (items.length === 0) continue;

      const parsedTime = new Date(mealRecords[0].recordedAt.replace(" ", "T"));
      // Fall back to the day's start if chaodays sent a malformed timestamp, so a
      // bad `recorded_at` can't produce an Invalid Date the DB would reject.
      const time = Number.isNaN(parsedTime.getTime()) ? new Date(`${day}T00:00:00`) : parsedTime;
      await mealRepository.upsertMealWithItems({ userId: input.userId, day, meal, time, items });
      mealsImported++;
    }

    const existingVitals = await vitalsRepository.get(input.userId, day);
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
      await vitalsRepository.set({
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

  return { mealsImported, mealsSkipped, glucoseImported, from: input.from, to: input.to };
}
