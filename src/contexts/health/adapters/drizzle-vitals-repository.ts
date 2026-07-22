import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
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
    // Legacy readings predate `time`; coerce a missing/non-string time to "".
    bpReadings: row.bpReadings.map((r) => ({ ...r, time: typeof r.time === "string" ? r.time : "" })),
    glucoseReadings: row.glucoseReadings.map((r) => ({ ...r, time: typeof r.time === "string" ? r.time : "" })),
    spo2Readings: row.spo2Readings.map((r) => ({ ...r, time: typeof r.time === "string" ? r.time : "" })),
  };
}

/** Driven adapter: implements VitalsRepository via Drizzle + Neon. */
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

  async getLatestWeight(userId: string): Promise<number | null> {
    return this.readWeight(userId, "latest");
  }

  async getEarliestWeight(userId: string): Promise<number | null> {
    return this.readWeight(userId, "earliest");
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
