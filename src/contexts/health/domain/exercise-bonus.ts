/** The most bonus portions a single day's exercise can add per category (a
 * guard so an unusually long logged session can't inflate the target without
 * bound). */
export const MAX_EXERCISE_BONUS_PORTIONS = 8;

/** Minutes of exercise that earn one bonus portion. */
export const MINUTES_PER_BONUS_PORTION = 30;

/**
 * The bonus portions a day's exercise adds — one portion per
 * {@link MINUTES_PER_BONUS_PORTION} minutes of total exercise (whole portions
 * only; a partial block earns nothing), capped at
 * {@link MAX_EXERCISE_BONUS_PORTIONS}. Applied to both staple and meat
 * (carbohydrate replenishment + protein), following chaodays' "exercise raises
 * the day's food target" coupling.
 */
export function exerciseBonusPortions(totalMinutes: number): number {
  if (!(totalMinutes > 0)) return 0;
  const portions = Math.floor(totalMinutes / MINUTES_PER_BONUS_PORTION);
  return Math.min(portions, MAX_EXERCISE_BONUS_PORTIONS);
}
