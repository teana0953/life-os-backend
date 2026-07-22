import type { BowelRepository } from "../domain/bowel-repository";

export interface BowelDay {
  day: string;
  count: number;
  isNormal: boolean | null;
  note: string;
}

/**
 * Use case: a day's bowel record. When the day has no record, reports the empty
 * default (count 0, null flag, empty note) — mirroring diet/water's "no record →
 * default" behaviour.
 */
export async function getBowelDay(repository: BowelRepository, userId: string, day: string): Promise<BowelDay> {
  const log = await repository.get(userId, day);
  if (log) {
    return { day: log.day, count: log.count, isNormal: log.isNormal, note: log.note };
  }
  return { day, count: 0, isNormal: null, note: "" };
}
