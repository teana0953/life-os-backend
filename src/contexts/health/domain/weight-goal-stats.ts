/**
 * Pure weight-goal statistics (domain, zero outer imports). Both helpers return
 * null when their inputs are insufficient rather than throwing, so callers can
 * surface a null field.
 */

/** BMI = weight / (height/100)², to one decimal; null when either is null or ≤ 0. */
export function computeBmi(weightKg: number | null, heightCm: number | null): number | null {
  if (weightKg === null || heightCm === null || weightKg <= 0 || heightCm <= 0) return null;
  const heightM = heightCm / 100;
  return Math.round((weightKg / (heightM * heightM)) * 10) / 10;
}

/**
 * Achievement rate = (baseline − current) / (baseline − target) × 100, clamped
 * to 0–100 and rounded to an integer. Null when any input is null or when
 * baseline equals target (no progress denominator). When baseline equals current
 * this is 0 (no progress yet) — NOT null; the "not enough history" case (fewer
 * than two weight-recorded days) is decided by the caller via the day count, not
 * here, so two same-value days read 0% rather than "no data".
 */
export function computeAchievementRate(
  baseline: number | null,
  current: number | null,
  target: number | null,
): number | null {
  if (baseline === null || current === null || target === null) return null;
  if (baseline === target) return null;
  const rate = ((baseline - current) / (baseline - target)) * 100;
  return Math.round(Math.max(0, Math.min(100, rate)));
}
