import { and, asc, count, desc, eq, gte, isNotNull, lte } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { vitals } from "../../../shared/db/schema";
import type { VitalsRecord } from "../domain/vitals";
import type { SetVitalsInput, VitalsRepository } from "../domain/vitals-repository";

type VitalsRow = typeof vitals.$inferSelect;

function toDomain(row: VitalsRow): VitalsRecord {
  return {
    userId: row.userId,
    day: row.day,
    weightKg: row.weightKg == null ? null : Number(row.weightKg),
    bodyFatPct: row.bodyFatPct == null ? null : Number(row.bodyFatPct),
    waistCm: row.waistCm == null ? null : Number(row.waistCm),
    // Legacy readings predate `time`; coerce a missing/non-string time to "".
    bpReadings: row.bpReadings.map((r) => ({ ...r, time: typeof r.time === "string" ? r.time : "" })),
    glucoseReadings: row.glucoseReadings.map((r) => ({
      ...r,
      // Legacy readings predate `mealContext`; coerce a missing one to null.
      mealContext: r.mealContext ?? null,
      time: typeof r.time === "string" ? r.time : "",
    })),
    spo2Readings: row.spo2Readings.map((r) => ({ ...r, time: typeof r.time === "string" ? r.time : "" })),
  };
}

export class DrizzleVitalsRepository implements VitalsRepository {
  constructor(private readonly getDb: () => Db) {}

  async get(userId: string, day: string): Promise<VitalsRecord | null> {
    const db = this.getDb();
    const [row] = await db
      .select()
      .from(vitals)
      .where(and(eq(vitals.userId, userId), eq(vitals.day, day)))
      .limit(1);
    return row ? toDomain(row) : null;
  }

  async set(input: SetVitalsInput): Promise<VitalsRecord> {
    const db = this.getDb();
    const values = {
      userId: input.userId,
      day: input.day,
      weightKg: input.weightKg == null ? null : String(input.weightKg),
      bodyFatPct: input.bodyFatPct == null ? null : String(input.bodyFatPct),
      waistCm: input.waistCm == null ? null : String(input.waistCm),
      bpReadings: input.bpReadings,
      glucoseReadings: input.glucoseReadings,
      spo2Readings: input.spo2Readings,
    };
    const [row] = await db
      .insert(vitals)
      .values(values)
      .onConflictDoUpdate({ target: [vitals.userId, vitals.day], set: values })
      .returning();
    if (!row) throw new Error("failed to set vitals");
    return toDomain(row);
  }

  async setMany(rows: SetVitalsInput[]): Promise<void> {
    if (rows.length === 0) return;
    const db = this.getDb();
    const [first, ...rest] = rows.map((input) => {
      const values = {
        userId: input.userId,
        day: input.day,
        weightKg: input.weightKg == null ? null : String(input.weightKg),
        bodyFatPct: input.bodyFatPct == null ? null : String(input.bodyFatPct),
        waistCm: input.waistCm == null ? null : String(input.waistCm),
        bpReadings: input.bpReadings,
        glucoseReadings: input.glucoseReadings,
        spo2Readings: input.spo2Readings,
      };
      return db.insert(vitals).values(values).onConflictDoUpdate({ target: [vitals.userId, vitals.day], set: values });
    });
    await db.batch([first, ...rest]);
  }

  async listRange(userId: string, from: string, to: string): Promise<VitalsRecord[]> {
    const db = this.getDb();
    const rows = await db
      .select()
      .from(vitals)
      .where(and(eq(vitals.userId, userId), gte(vitals.day, from), lte(vitals.day, to)))
      .orderBy(asc(vitals.day));
    return rows.map(toDomain);
  }

  async getLatestWeight(userId: string): Promise<number | null> {
    return this.readWeight(userId, "latest");
  }

  async getEarliestWeight(userId: string): Promise<number | null> {
    return this.readWeight(userId, "earliest");
  }

  async getWeightDayCount(userId: string): Promise<number> {
    const db = this.getDb();
    // vitals holds one row per (user, day), so counting rows with a non-null
    // weight counts the distinct days on which a weight was recorded.
    const [row] = await db
      .select({ count: count() })
      .from(vitals)
      .where(and(eq(vitals.userId, userId), isNotNull(vitals.weightKg)));
    return Number(row?.count ?? 0);
  }

  private async readWeight(userId: string, which: "latest" | "earliest"): Promise<number | null> {
    const db = this.getDb();
    const [row] = await db
      .select({ weightKg: vitals.weightKg })
      .from(vitals)
      .where(and(eq(vitals.userId, userId), isNotNull(vitals.weightKg)))
      .orderBy(which === "latest" ? desc(vitals.day) : asc(vitals.day))
      .limit(1);
    return row?.weightKg == null ? null : Number(row.weightKg);
  }
}
