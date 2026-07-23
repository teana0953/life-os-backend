import type { ChaodaysClient } from "../domain/chaodays-client";
import type { VitalsRepository } from "../domain/vitals-repository";

export interface ImportChaodaysWeightInput {
  userId: string;
  uid: string;
  password: string;
  /** ISO calendar date, e.g. "2026-07-18". */
  from: string;
  to: string;
}

export interface ImportChaodaysWeightSummary {
  imported: number;
  skipped: number;
  from: string;
  to: string;
}

/**
 * Use case: sign in to chaodays, pull weight/body-fat records for `[from, to]`,
 * and read-modify-write each day's vitals — setting only weight/body fat, keeping
 * existing bp/glucose/spo2 readings. A record with no weight is skipped (counted,
 * not written). A record with no body fat leaves the day's existing body fat intact.
 */
export async function importChaodaysWeight(
  vitalsRepository: VitalsRepository,
  chaodaysClient: ChaodaysClient,
  input: ImportChaodaysWeightInput,
): Promise<ImportChaodaysWeightSummary> {
  const session = await chaodaysClient.signIn(input.uid, input.password);
  const { records } = await chaodaysClient.fetchWeightRecords(session, input.from, input.to);

  let imported = 0;
  let skipped = 0;
  for (const record of records) {
    if (record.weight === null) {
      skipped++;
      continue;
    }
    const existing = await vitalsRepository.get(input.userId, record.date);
    await vitalsRepository.set({
      userId: input.userId,
      day: record.date,
      weightKg: record.weight,
      bodyFatPct: record.bodyFatPct ?? existing?.bodyFatPct ?? null,
      bpReadings: existing?.bpReadings ?? [],
      glucoseReadings: existing?.glucoseReadings ?? [],
      spo2Readings: existing?.spo2Readings ?? [],
    });
    imported++;
  }

  return { imported, skipped, from: input.from, to: input.to };
}
