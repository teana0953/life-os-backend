import type { ChaodaysClient, ChaodaysWeightRecord } from "../domain/chaodays-client";
import type { VitalsRecord } from "../domain/vitals";
import type { SetVitalsInput, VitalsRepository } from "../domain/vitals-repository";
import { fetchInBatches } from "./fetch-in-batches";

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
 * and merge them into each day's vitals, keeping existing bp/glucose/spo2
 * readings. A record with no weight is skipped (counted, not written).
 *
 * To keep the number of DB round-trips independent of the date range, existing
 * vitals for the whole range are read once, everything is computed in memory,
 * and all writes are persisted via one batched `setMany` call.
 *
 * Within a day, records are folded in order to replicate the previous
 * per-record read-after-write behavior: the day's final weight is the last
 * weighted record's, and its body fat is the last non-null body fat among the
 * day's records, else the pre-import value (so a later same-day record
 * lacking body fat inherits an earlier one's, and a day with no imported body
 * fat keeps its existing one).
 */
export async function importChaodaysWeight(
  vitalsRepository: VitalsRepository,
  chaodaysClient: ChaodaysClient,
  input: ImportChaodaysWeightInput,
): Promise<ImportChaodaysWeightSummary> {
  const session = await chaodaysClient.signIn(input.uid, input.password);
  const records = await fetchInBatches(session, input.from, input.to, (batchSession, from, to) =>
    chaodaysClient.fetchWeightRecords(batchSession, from, to),
  );

  const recordsByDay = new Map<string, ChaodaysWeightRecord[]>();
  for (const record of records) {
    const list = recordsByDay.get(record.date) ?? [];
    list.push(record);
    recordsByDay.set(record.date, list);
  }

  // Read for the whole range happens once, before any writes.
  const existingVitalsRecords = await vitalsRepository.listRange(input.userId, input.from, input.to);
  const existingByDay = new Map<string, VitalsRecord>();
  for (const record of existingVitalsRecords) {
    existingByDay.set(record.day, record);
  }

  let imported = 0;
  let skipped = 0;
  const rows: SetVitalsInput[] = [];

  for (const [day, dayRecords] of recordsByDay) {
    const existing = existingByDay.get(day) ?? null;
    let weight: number | null = null;
    let bodyFat: number | null = existing?.bodyFatPct ?? null;
    let touched = false;

    for (const record of dayRecords) {
      if (record.weight === null) {
        skipped++;
        continue;
      }
      weight = record.weight;
      bodyFat = record.bodyFatPct ?? bodyFat;
      touched = true;
      imported++;
    }

    if (!touched) continue;

    rows.push({
      userId: input.userId,
      day,
      weightKg: weight,
      bodyFatPct: bodyFat,
      // chaodays has no waist figure, so this import must carry forward
      // whatever the user recorded here. `set` is a whole-row upsert, so a
      // field left out is a field erased.
      waistCm: existing?.waistCm ?? null,
      bpReadings: existing?.bpReadings ?? [],
      glucoseReadings: existing?.glucoseReadings ?? [],
      spo2Readings: existing?.spo2Readings ?? [],
    });
  }

  if (rows.length > 0) await vitalsRepository.setMany(rows);

  return { imported, skipped, from: input.from, to: input.to };
}
