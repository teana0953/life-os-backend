/** Read-only cross-tracker access for the monthly health calendar. */
export interface HealthCalendarRepository {
  /**
   * The distinct days (`YYYY-MM-DD`, ascending) within `[from, to]` that have at
   * least one entry across the day-keyed trackers (meals, water, bowel,
   * exercise, vitals).
   */
  listLoggedDays(userId: string, from: string, to: string): Promise<string[]>;
}
