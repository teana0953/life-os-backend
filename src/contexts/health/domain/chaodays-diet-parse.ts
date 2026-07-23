import type { GlucoseReading } from "./vitals";

// Full-width and half-width colons are both used by chaodays free text.
const PRE_MEAL_RE = /前血糖[:：]\s*(\d+)/g;
const POST_MEAL_RE = /後血糖(?:[（(](\d+)hr[）)])?[:：]\s*(\d+)/g;
const FASTING_RE = /空腹(?:血糖)?[:：]\s*(\d+)/g;

/**
 * Parses chaodays free-text blood-glucose notes (embedded in a diet item's
 * `name`) into structured readings, using the record's time-of-day for each.
 * A marker with no numeric value (e.g. `後血糖：` with nothing after it) is
 * skipped rather than producing a broken reading.
 */
export function parseGlucoseReadings(name: string, time: string): GlucoseReading[] {
  const readings: GlucoseReading[] = [];

  for (const match of name.matchAll(PRE_MEAL_RE)) {
    readings.push({ label: "餐前", value: Number(match[1]), mealContext: "pre_meal", time });
  }
  for (const match of name.matchAll(POST_MEAL_RE)) {
    const hr = match[1];
    readings.push({ label: hr ? `餐後${hr}hr` : "餐後", value: Number(match[2]), mealContext: "post_meal", time });
  }
  for (const match of name.matchAll(FASTING_RE)) {
    readings.push({ label: "空腹", value: Number(match[1]), mealContext: "fasting", time });
  }

  return readings;
}

/** Strips chaodays glucose free-text out of a diet item's `name`, leaving the food description (trimmed). */
export function stripGlucoseText(name: string): string {
  return name
    .replace(PRE_MEAL_RE, "")
    .replace(POST_MEAL_RE, "")
    .replace(FASTING_RE, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("\n")
    .trim();
}
