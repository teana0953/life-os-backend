import type { ChaodaysClient } from "../domain/chaodays-client";
import { periodsOverlap } from "../domain/menstrual-period";
import type { PeriodDates } from "../domain/menstrual-period";
import type { MenstrualRepository } from "../domain/menstrual-repository";
import { addPeriod } from "./add-period";
import { fetchInBatches } from "./fetch-in-batches";

export interface ImportChaodaysMenstrualInput {
  userId: string;
  uid: string;
  password: string;
  /** ISO calendar date, e.g. "2026-07-18". */
  from: string;
  to: string;
}

export interface ImportChaodaysMenstrualSummary {
  imported: number;
  skipped: number;
  from: string;
  to: string;
}

/**
 * Use case: sign in to chaodays, pull menstrual periods for `[from, to]`, and
 * create the ones lifeos does not already know about.
 *
 * A source period is skipped when it overlaps any period already known —
 * lifeos' own, or one accepted earlier in this same import. Overlap rather than
 * an equal start date, because the same real period recorded in both apps often
 * differs by a day, and storing it twice would corrupt the cycle statistics the
 * data exists to produce. Existing records are never overwritten.
 *
 * A period chaodays has not yet closed is not imported at all: it is data still
 * changing, and as an open lifeos period it would suppress every later import
 * until someone edited it by hand. Re-importing once it has ended brings it in.
 *
 * Source periods are de-duplicated by chaodays' record id BEFORE anything is
 * counted, because a period spanning a fetch-batch boundary may come back in
 * more than one batch. Counting each sighting would make the reported numbers
 * depend on how the range happened to be split.
 *
 * All fetching happens first, then existing periods are read once, then writes
 * go out — so a failed fetch means nothing was written and a retry is clean.
 * Writes go through `addPeriod` rather than the repository directly: it is the
 * only guard on "an end date is not earlier than its start date", and an import
 * must not be a back door around a rule manual entry obeys.
 */
export async function importChaodaysMenstrual(
  menstrualRepository: MenstrualRepository,
  chaodaysClient: ChaodaysClient,
  input: ImportChaodaysMenstrualInput,
): Promise<ImportChaodaysMenstrualSummary> {
  const session = await chaodaysClient.signIn(input.uid, input.password);
  const fetched = await fetchInBatches(session, input.from, input.to, (batchSession, from, to) =>
    chaodaysClient.fetchMenstruals(batchSession, from, to),
  );

  const seenIds = new Set<number>();
  const sourcePeriods = fetched.filter((record) => {
    if (seenIds.has(record.id)) return false;
    seenIds.add(record.id);
    return true;
  });

  // Read for the whole user happens once, after every fetch and before any write.
  const known: PeriodDates[] = await menstrualRepository.listByUser(input.userId);

  let imported = 0;
  let skipped = 0;

  for (const source of sourcePeriods) {
    if (source.endDate === null || known.some((period) => periodsOverlap(period, source))) {
      skipped++;
      continue;
    }
    await addPeriod(menstrualRepository, {
      userId: input.userId,
      startDate: source.startDate,
      endDate: source.endDate,
    });
    known.push({ startDate: source.startDate, endDate: source.endDate });
    imported++;
  }

  return { imported, skipped, from: input.from, to: input.to };
}
