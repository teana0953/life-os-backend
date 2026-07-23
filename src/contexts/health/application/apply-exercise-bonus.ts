import type { DailyTargetRepository } from "../domain/daily-target-repository";
import { exerciseBonusPortions } from "../domain/exercise-bonus";
import type { ExerciseRepository } from "../domain/exercise-repository";

/**
 * Use case: recompute a day's exercise-driven food bonus and write it into that
 * day's daily target. The bonus (staple + meat) comes from the day's total
 * exercise minutes; the day's base target is preserved (its own if set, else the
 * most recent carried-forward base, else zero). Called after the day's exercise
 * entries change, so `effective = base + bonus` (and remaining) reflect it.
 */
export async function applyExerciseBonus(
  dailyTargetRepository: DailyTargetRepository,
  exerciseRepository: ExerciseRepository,
  userId: string,
  day: string,
): Promise<void> {
  const entries = await exerciseRepository.listByDay(userId, day);
  const totalMinutes = entries.reduce((sum, e) => sum + e.durationMinutes, 0);
  const bonus = exerciseBonusPortions(totalMinutes);

  const exact = await dailyTargetRepository.get(userId, day);
  const carry = exact ? null : await dailyTargetRepository.getLatestOnOrBefore(userId, day);
  const base = exact ?? carry;

  // Exercise owns only the staple + meat bonus (carbohydrate + protein); any
  // fruit/veg bonus set by hand on the day's own target is preserved, not reset.
  await dailyTargetRepository.set({
    userId,
    day,
    baseStaple: base?.baseStaple ?? 0,
    baseMeat: base?.baseMeat ?? 0,
    baseFruit: base?.baseFruit ?? 0,
    baseVeg: base?.baseVeg ?? 0,
    bonusStaple: bonus,
    bonusMeat: bonus,
    bonusFruit: exact?.bonusFruit ?? 0,
    bonusVeg: exact?.bonusVeg ?? 0,
  });
}
