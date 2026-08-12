import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { careDayInstancePointer } from "../../../shared/db/schema";
import type { CareDayInstancePointerStore } from "../domain/care-day-instance";

/**
 * Driven adapter: implements `CareDayInstancePointerStore` via the
 * `care_day_instance_pointer` table. `setCurrentIfMatch`'s CAS is a single
 * `INSERT ... ON CONFLICT (user_id) DO UPDATE ... setWhere` statement — the
 * same leased-conditional-update shape `DrizzleCareOccurrenceRepository.
 * claimAttempt` uses — so the compare-and-swap is atomic in Postgres itself,
 * not emulated with a read-then-write from this adapter (which two
 * concurrent callers could both pass).
 */
export class DrizzleCareDayInstancePointerStore implements CareDayInstancePointerStore {
  constructor(private readonly getDb: () => Db) {}

  async getCurrent(userId: string, localDate: string): Promise<string | null> {
    const db = this.getDb();
    const [row] = await db
      .select({ instanceId: careDayInstancePointer.instanceId })
      .from(careDayInstancePointer)
      .where(and(eq(careDayInstancePointer.userId, userId), eq(careDayInstancePointer.localDate, localDate)))
      .limit(1);
    return row?.instanceId ?? null;
  }

  async setCurrentIfMatch(userId: string, localDate: string, expected: string | null, newInstanceId: string): Promise<boolean> {
    const db = this.getDb();
    const now = new Date();
    // The swap succeeds only if the on-disk row still matches `expected`:
    // when `expected` is null, that means "still no row for today" (the
    // stored local_date, if any, is still not today's); otherwise it means
    // "still exactly the recorded instance id for today". Either way this is
    // evaluated by Postgres as part of the single upsert statement, so a
    // concurrent winner's write is either fully visible or not at all.
    const setWhere =
      expected === null
        ? sql`${careDayInstancePointer.localDate} <> ${localDate}`
        : sql`${careDayInstancePointer.localDate} = ${localDate} and ${careDayInstancePointer.instanceId} = ${expected}`;
    const rows = await db
      .insert(careDayInstancePointer)
      .values({ userId, localDate, instanceId: newInstanceId, updatedAt: now })
      .onConflictDoUpdate({
        target: careDayInstancePointer.userId,
        set: { localDate, instanceId: newInstanceId, updatedAt: now },
        setWhere,
      })
      .returning({ userId: careDayInstancePointer.userId });
    return rows.length > 0;
  }
}
