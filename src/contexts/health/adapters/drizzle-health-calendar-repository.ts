import { and, eq, gte, lte } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Db } from "../../../shared/db/client";
import { bowelLog, exerciseLog, mealEntry, vitals, waterIntake } from "../../../shared/db/schema";
import type { HealthCalendarRepository } from "../domain/health-calendar-repository";

/** The day-keyed tracker tables whose entries count as "logged that day". */
const LOGGED_TABLES: { table: PgTable; userId: PgColumn; day: PgColumn }[] = [
  { table: mealEntry, userId: mealEntry.userId, day: mealEntry.day },
  { table: waterIntake, userId: waterIntake.userId, day: waterIntake.day },
  { table: bowelLog, userId: bowelLog.userId, day: bowelLog.day },
  { table: exerciseLog, userId: exerciseLog.userId, day: exerciseLog.day },
  { table: vitals, userId: vitals.userId, day: vitals.day },
];

export class DrizzleHealthCalendarRepository implements HealthCalendarRepository {
  constructor(private readonly getDb: () => Db) {}

  async listLoggedDays(userId: string, from: string, to: string): Promise<string[]> {
    const db = this.getDb();
    const perTable = await Promise.all(
      LOGGED_TABLES.map(({ table, userId: userCol, day }) =>
        db
          .selectDistinct({ day })
          .from(table)
          .where(and(eq(userCol, userId), gte(day, from), lte(day, to))),
      ),
    );
    const days = new Set<string>();
    for (const rows of perTable) {
      for (const row of rows) days.add(row.day as string);
    }
    return [...days].sort();
  }
}
