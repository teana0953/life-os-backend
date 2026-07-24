import type { BowelRepository, SetBowelLogInput } from "../domain/bowel-repository";
import type { ChaodaysClient, ChaodaysDefecationRecord } from "../domain/chaodays-client";

export interface ImportChaodaysBowelInput {
  userId: string;
  uid: string;
  password: string;
  /** ISO calendar date, e.g. "2026-07-18". */
  from: string;
  to: string;
}

export interface ImportChaodaysBowelSummary {
  imported: number;
  skipped: number;
  from: string;
  to: string;
}

/**
 * Use case: sign in to chaodays, pull defecation records for `[from, to]`,
 * and aggregate each day's records into one bowel log — count summed,
 * isNormal = not any record flagged abnormal (chaodays records abnormality,
 * lifeos records normality, so the flag is inverted), notes joined. A day
 * that already has a lifeos bowel log is skipped (counted, not clobbered).
 *
 * To keep the number of DB round-trips independent of the date range, existing
 * bowel logs for the whole range are read once, everything is computed in
 * memory, and all writes are persisted via one batched `setMany` call.
 */
export async function importChaodaysBowel(
  bowelRepository: BowelRepository,
  chaodaysClient: ChaodaysClient,
  input: ImportChaodaysBowelInput,
): Promise<ImportChaodaysBowelSummary> {
  const session = await chaodaysClient.signIn(input.uid, input.password);
  const { records } = await chaodaysClient.fetchDefecationRecords(session, input.from, input.to);

  const recordsByDay = new Map<string, ChaodaysDefecationRecord[]>();
  for (const record of records) {
    const list = recordsByDay.get(record.date) ?? [];
    list.push(record);
    recordsByDay.set(record.date, list);
  }

  // Read for the whole range happens once, before any writes.
  const existingLogs = await bowelRepository.listRange(input.userId, input.from, input.to);
  const existingDays = new Set(existingLogs.map((log) => log.day));

  let imported = 0;
  let skipped = 0;
  const rows: SetBowelLogInput[] = [];

  for (const [day, dayRecords] of recordsByDay) {
    if (existingDays.has(day)) {
      skipped++;
      continue;
    }

    const count = dayRecords.reduce((sum, r) => sum + r.count, 0);
    const isNormal = !dayRecords.some((r) => r.isAbnormality);
    const note = dayRecords
      .map((r) => r.note)
      .filter((n) => n !== "")
      .join("\n");

    rows.push({ userId: input.userId, day, count, isNormal, note });
    imported++;
  }

  if (rows.length > 0) await bowelRepository.setMany(rows);

  return { imported, skipped, from: input.from, to: input.to };
}
