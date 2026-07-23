import type { BodyProfileRepository } from "../domain/body-profile-repository";
import type { VitalsRepository } from "../domain/vitals-repository";
import { computeAchievementRate, computeBmi } from "../domain/weight-goal-stats";

export interface WeightGoalOverview {
  heightCm: number | null;
  targetWeightKg: number | null;
  currentWeightKg: number | null;
  remainingKg: number | null;
  achievementRate: number | null;
  bmi: number | null;
}

/**
 * Use case: the derived weight-goal overview. Current weight is the latest
 * recorded vitals weight, the baseline is the earliest; remaining, BMI and
 * achievement rate are computed on read (never stored).
 */
export async function getWeightGoal(
  bodyProfileRepository: BodyProfileRepository,
  vitalsRepository: VitalsRepository,
  userId: string,
): Promise<WeightGoalOverview> {
  const profile = await bodyProfileRepository.get(userId);
  const heightCm = profile?.heightCm ?? null;
  const targetWeightKg = profile?.targetWeightKg ?? null;

  const currentWeightKg = await vitalsRepository.getLatestWeight(userId);
  const baseline = await vitalsRepository.getEarliestWeight(userId);
  const weightDayCount = await vitalsRepository.getWeightDayCount(userId);

  const remainingKg =
    currentWeightKg !== null && targetWeightKg !== null ? currentWeightKg - targetWeightKg : null;

  // Progress needs a baseline distinct from today's measurement — i.e. weight on
  // at least two different days. With fewer, there's no progress to show yet
  // (null); the frontend shows a "record on another day" hint.
  const achievementRate =
    weightDayCount >= 2 ? computeAchievementRate(baseline, currentWeightKg, targetWeightKg) : null;

  return {
    heightCm,
    targetWeightKg,
    currentWeightKg,
    remainingKg,
    achievementRate,
    bmi: computeBmi(currentWeightKg, heightCm),
  };
}
