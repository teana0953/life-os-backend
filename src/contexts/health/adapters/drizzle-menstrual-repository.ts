import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { menstrualPeriod } from "../../../shared/db/schema";
import type { MenstrualPeriod } from "../domain/menstrual-period";
import type { AddPeriodInput, MenstrualRepository, UpdatePeriodPatch } from "../domain/menstrual-repository";

type MenstrualPeriodRow = typeof menstrualPeriod.$inferSelect;

function toDomain(row: MenstrualPeriodRow): MenstrualPeriod {
  return {
    id: row.id,
    userId: row.userId,
    startDate: row.startDate,
    endDate: row.endDate,
  };
}

/** Driven adapter: implements MenstrualRepository via Drizzle + Neon. */
export class DrizzleMenstrualRepository implements MenstrualRepository {
  constructor(private readonly getDb: () => Db) {}

  async add(input: AddPeriodInput): Promise<MenstrualPeriod> {
    const db = this.getDb();
    const [row] = await db
      .insert(menstrualPeriod)
      .values({
        userId: input.userId,
        startDate: input.startDate,
        endDate: input.endDate,
      })
      .returning();
    if (!row) throw new Error("failed to add menstrual period");
    return toDomain(row);
  }

  async listByUser(userId: string): Promise<MenstrualPeriod[]> {
    const db = this.getDb();
    const rows = await db
      .select()
      .from(menstrualPeriod)
      .where(eq(menstrualPeriod.userId, userId))
      .orderBy(asc(menstrualPeriod.startDate));
    return rows.map(toDomain);
  }

  async update(userId: string, id: string, patch: UpdatePeriodPatch): Promise<MenstrualPeriod | null> {
    const db = this.getDb();
    // Apply only the patch's present fields; `endDate: null` clears the column.
    const values: Partial<typeof menstrualPeriod.$inferInsert> = {};
    if ("startDate" in patch && patch.startDate !== undefined) values.startDate = patch.startDate;
    if ("endDate" in patch) values.endDate = patch.endDate ?? null;

    const [row] = await db
      .update(menstrualPeriod)
      .set(values)
      .where(and(eq(menstrualPeriod.id, id), eq(menstrualPeriod.userId, userId)))
      .returning();
    return row ? toDomain(row) : null;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const db = this.getDb();
    const deleted = await db
      .delete(menstrualPeriod)
      .where(and(eq(menstrualPeriod.id, id), eq(menstrualPeriod.userId, userId)))
      .returning({ id: menstrualPeriod.id });
    return deleted.length > 0;
  }
}
