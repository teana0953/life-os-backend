import type { ChaodaysClient } from "../domain/chaodays-client";
import type { WaterRepository } from "../domain/water-repository";

export interface ImportChaodaysWaterInput {
  userId: string;
  uid: string;
  password: string;
  /** ISO calendar date, e.g. "2026-07-18". */
  from: string;
  to: string;
}

export interface ImportChaodaysWaterSummary {
  imported: number;
  skipped: number;
  from: string;
  to: string;
}

/**
 * Use case: sign in to chaodays, pull water records for `[from, to]`, sum each
 * day's entries, and add the sum to that day's lifeos intake. A day whose sum
 * is <= 0 is not written (and not counted). A day that already has lifeos
 * intake is skipped (counted, not clobbered) — `WaterRepository` has no
 * "set total" method and `addIntake` is additive, so this is how re-import
 * stays idempotent.
 *
 * To keep the number of DB round-trips independent of the date range, existing
 * intake for the whole range is read once, everything is computed in memory,
 * and all writes are persisted via one batched `addIntakeMany` call.
 */
export async function importChaodaysWater(
  waterRepository: WaterRepository,
  chaodaysClient: ChaodaysClient,
  input: ImportChaodaysWaterInput,
): Promise<ImportChaodaysWaterSummary> {
  const session = await chaodaysClient.signIn(input.uid, input.password);
  const { records } = await chaodaysClient.fetchWaterRecords(session, input.from, input.to);

  const totalByDay = new Map<string, number>();
  for (const record of records) {
    totalByDay.set(record.date, (totalByDay.get(record.date) ?? 0) + record.waterMl);
  }

  // Read for the whole range happens once, before any writes.
  const existingIntake = await waterRepository.listIntakeRange(input.userId, input.from, input.to);
  const existingDays = new Set(existingIntake.map((intake) => intake.day));

  let imported = 0;
  let skipped = 0;
  const rows: { userId: string; day: string; addMl: number }[] = [];

  for (const [day, total] of totalByDay) {
    if (total <= 0) continue;
    if (existingDays.has(day)) {
      skipped++;
      continue;
    }
    rows.push({ userId: input.userId, day, addMl: total });
    imported++;
  }

  if (rows.length > 0) await waterRepository.addIntakeMany(rows);

  return { imported, skipped, from: input.from, to: input.to };
}
