import { and, eq } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { careLog } from "../../../shared/db/schema";
import type { CareLog, CareLogRepository, CareLogStatus, CreateCareLogInput } from "../domain/care-log";

type CareLogRow = typeof careLog.$inferSelect;

function toDomain(row: CareLogRow): CareLog {
  return {
    id: row.id,
    userId: row.userId,
    careItemId: row.careItemId,
    careScheduleId: row.careScheduleId,
    localDate: row.localDate,
    timeOfDay: row.timeOfDay,
    status: row.status as CareLogStatus,
    doneTime: row.doneTime,
    doseQuantity: row.doseQuantity,
  };
}

/** Driven adapter: implements CareLogRepository via Drizzle + Neon. */
export class DrizzleCareLogRepository implements CareLogRepository {
  constructor(private readonly getDb: () => Db) {}

  async upsertIfAbsent(input: CreateCareLogInput): Promise<{ log: CareLog; created: boolean }> {
    const db = this.getDb();
    const [created] = await db
      .insert(careLog)
      .values({
        userId: input.userId,
        careItemId: input.careItemId,
        careScheduleId: input.careScheduleId,
        localDate: input.localDate,
        timeOfDay: input.timeOfDay,
        status: input.status,
        doneTime: input.doneTime,
        doseQuantity: input.doseQuantity,
      })
      .onConflictDoNothing({ target: [careLog.careScheduleId, careLog.localDate, careLog.timeOfDay] })
      .returning();
    if (created) return { log: toDomain(created), created: true };

    // Already logged by an earlier answer or markMissed pass (D6/D7 in design.md).
    const [existing] = await db
      .select()
      .from(careLog)
      .where(
        and(
          eq(careLog.careScheduleId, input.careScheduleId),
          eq(careLog.localDate, input.localDate),
          eq(careLog.timeOfDay, input.timeOfDay),
        ),
      )
      .limit(1);
    if (!existing) throw new Error("failed to upsert care log");
    return { log: toDomain(existing), created: false };
  }

  async getBySlot(careScheduleId: string, localDate: string, timeOfDay: string): Promise<CareLog | null> {
    const db = this.getDb();
    const [row] = await db
      .select()
      .from(careLog)
      .where(and(eq(careLog.careScheduleId, careScheduleId), eq(careLog.localDate, localDate), eq(careLog.timeOfDay, timeOfDay)))
      .limit(1);
    return row ? toDomain(row) : null;
  }
}
