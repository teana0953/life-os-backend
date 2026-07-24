import { and, eq, isNull, lt } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { careLog, careOccurrence } from "../../../shared/db/schema";
import type { CareOccurrence, CareOccurrenceRepository, CreateCareOccurrenceInput } from "../domain/care-occurrence";

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

  async touchNotified(id: string, at: Date): Promise<void> {
    const db = this.getDb();
    await db.update(careOccurrence).set({ lastNotifiedAt: at }).where(eq(careOccurrence.id, id));
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
}
