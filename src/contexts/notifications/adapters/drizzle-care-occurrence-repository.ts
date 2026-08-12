import { and, eq, isNull, lt, lte, or } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { careLog, careOccurrence } from "../../../shared/db/schema";
import type { ClaimAttemptInput, CareOccurrence, CareOccurrenceRepository, CreateCareOccurrenceInput, RecordAttemptInput } from "../domain/care-occurrence";

type CareOccurrenceRow = typeof careOccurrence.$inferSelect;

function toDomain(row: CareOccurrenceRow): CareOccurrence {
  return {
    id: row.id,
    userId: row.userId,
    careItemId: row.careItemId,
    careScheduleId: row.careScheduleId,
    localDate: row.localDate,
    timeOfDay: row.timeOfDay,
    lastNotifiedAt: row.lastNotifiedAt,
    lastAttemptAt: row.lastAttemptAt,
    lastSendOutcome: row.lastSendOutcome as CareOccurrence["lastSendOutcome"],
    lastSendDetail: row.lastSendDetail,
  };
}

/** Driven adapter: implements CareOccurrenceRepository via Drizzle + Neon. */
export class DrizzleCareOccurrenceRepository implements CareOccurrenceRepository {
  constructor(private readonly getDb: () => Db) {}

  async upsertBySlot(input: CreateCareOccurrenceInput): Promise<CareOccurrence> {
    const db = this.getDb();
    const [created] = await db
      .insert(careOccurrence)
      .values({
        userId: input.userId,
        careItemId: input.careItemId,
        careScheduleId: input.careScheduleId,
        localDate: input.localDate,
        timeOfDay: input.timeOfDay,
      })
      .onConflictDoNothing({ target: [careOccurrence.careScheduleId, careOccurrence.localDate, careOccurrence.timeOfDay] })
      .returning();
    if (created) return toDomain(created);

    // Already materialized by an earlier or overlapping tick (D5 in design.md).
    const [existing] = await db
      .select()
      .from(careOccurrence)
      .where(
        and(
          eq(careOccurrence.careScheduleId, input.careScheduleId),
          eq(careOccurrence.localDate, input.localDate),
          eq(careOccurrence.timeOfDay, input.timeOfDay),
        ),
      )
      .limit(1);
    if (!existing) throw new Error("failed to upsert care occurrence");
    return toDomain(existing);
  }

  async getBySlot(careScheduleId: string, localDate: string, timeOfDay: string): Promise<CareOccurrence | null> {
    const db = this.getDb();
    const [row] = await db
      .select()
      .from(careOccurrence)
      .where(and(eq(careOccurrence.careScheduleId, careScheduleId), eq(careOccurrence.localDate, localDate), eq(careOccurrence.timeOfDay, timeOfDay)))
      .limit(1);
    return row ? toDomain(row) : null;
  }

  /**
   * Leased conditional claim (gate_decision #1 in
   * replace-cron-with-workflows/design.md): wins iff `last_attempt_at` is
   * `NULL` or older than `input.at - leaseMinutes`. The `UPDATE ... WHERE
   * ... RETURNING` pattern used elsewhere in this repository doubles as the
   * atomic test-and-set here — a concurrent/replayed caller racing this same
   * row either matches the `WHERE` (and both writes serialize, one losing)
   * or, once the first winner's write has landed, no longer matches it at
   * all (the lease is now fresh) until it goes stale again.
   */
  async claimAttempt(id: string, input: ClaimAttemptInput): Promise<boolean> {
    const db = this.getDb();
    const leaseBoundary = new Date(input.at.getTime() - input.leaseMinutes * 60_000);
    const updated = await db
      .update(careOccurrence)
      .set({ lastAttemptAt: input.at })
      .where(and(eq(careOccurrence.id, id), or(isNull(careOccurrence.lastAttemptAt), lte(careOccurrence.lastAttemptAt, leaseBoundary))))
      .returning({ id: careOccurrence.id });
    return updated.length > 0;
  }

  async recordAttempt(id: string, input: RecordAttemptInput): Promise<void> {
    const db = this.getDb();
    await db
      .update(careOccurrence)
      .set({
        lastAttemptAt: input.at,
        lastSendOutcome: input.outcome,
        lastSendDetail: input.detail,
        ...(input.delivered ? { lastNotifiedAt: input.at } : {}),
      })
      .where(eq(careOccurrence.id, id));
  }

  async listPastUnlogged(careScheduleId: string, todayLocalDate: string): Promise<CareOccurrence[]> {
    const db = this.getDb();
    const rows = await db
      .select({ occurrence: careOccurrence })
      .from(careOccurrence)
      .leftJoin(
        careLog,
        and(
          eq(careLog.careScheduleId, careOccurrence.careScheduleId),
          eq(careLog.localDate, careOccurrence.localDate),
          eq(careLog.timeOfDay, careOccurrence.timeOfDay),
        ),
      )
      .where(
        and(
          eq(careOccurrence.careScheduleId, careScheduleId),
          lt(careOccurrence.localDate, todayLocalDate),
          isNull(careLog.id),
        ),
      );
    return rows.map((row) => toDomain(row.occurrence));
  }

  async expediteNoSubscriptionsRetry(userId: string, localDate: string): Promise<void> {
    const db = this.getDb();
    await db
      .update(careOccurrence)
      .set({ lastAttemptAt: new Date(0) })
      .where(
        and(
          eq(careOccurrence.userId, userId),
          eq(careOccurrence.localDate, localDate),
          eq(careOccurrence.lastSendOutcome, "no_subscriptions"),
        ),
      );
  }
}
