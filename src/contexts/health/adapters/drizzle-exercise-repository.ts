import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { exerciseLog } from "../../../shared/db/schema";
import type { ExerciseEntry } from "../domain/exercise-entry";
import type { AddExerciseEntryInput, ExerciseRepository } from "../domain/exercise-repository";

type ExerciseLogRow = typeof exerciseLog.$inferSelect;

function toDomain(row: ExerciseLogRow): ExerciseEntry {
  return {
    id: row.id,
    userId: row.userId,
    day: row.day,
    activityId: row.activityId,
    durationMinutes: row.durationMinutes,
    note: row.note,
    createdAt: row.createdAt,
  };
}

/** Driven adapter: implements ExerciseRepository via Drizzle + Neon. */
export class DrizzleExerciseRepository implements ExerciseRepository {
  constructor(private readonly getDb: () => Db) {}

  async addEntry(input: AddExerciseEntryInput): Promise<ExerciseEntry> {
    const db = this.getDb();
    const [row] = await db
      .insert(exerciseLog)
      .values({
        userId: input.userId,
        day: input.day,
        activityId: input.activityId,
        durationMinutes: input.durationMinutes,
        note: input.note,
      })
      .returning();
    if (!row) throw new Error("failed to add exercise entry");
    return toDomain(row);
  }

  async listByDay(userId: string, day: string): Promise<ExerciseEntry[]> {
    const db = this.getDb();
    const rows = await db
      .select()
      .from(exerciseLog)
      .where(and(eq(exerciseLog.userId, userId), eq(exerciseLog.day, day)))
      .orderBy(asc(exerciseLog.createdAt));
    return rows.map(toDomain);
  }

  async deleteEntry(userId: string, entryId: string): Promise<string | null> {
    const db = this.getDb();
    const deleted = await db
      .delete(exerciseLog)
      .where(and(eq(exerciseLog.id, entryId), eq(exerciseLog.userId, userId)))
      .returning({ day: exerciseLog.day });
    return deleted[0]?.day ?? null;
  }
}
