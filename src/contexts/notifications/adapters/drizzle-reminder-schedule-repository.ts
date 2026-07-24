import { and, eq } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { reminderSchedule, users } from "../../../shared/db/schema";
import type {
  ActiveReminderSchedule,
  CreateReminderScheduleInput,
  ReminderSchedule,
  ReminderScheduleRepository,
  UpdateReminderSchedulePatch,
} from "../domain/reminder-schedule";

type ReminderScheduleRow = typeof reminderSchedule.$inferSelect;

function toDomain(row: ReminderScheduleRow): ReminderSchedule {
  return {
    id: row.id,
    userId: row.userId,
    category: row.category,
    label: row.label,
    times: row.times,
    daysOfWeek: row.daysOfWeek,
    weekInterval: row.weekInterval,
    anchorDate: row.anchorDate,
    enabled: row.enabled,
  };
}

/** Driven adapter: implements ReminderScheduleRepository via Drizzle + Neon. */
export class DrizzleReminderScheduleRepository implements ReminderScheduleRepository {
  constructor(private readonly getDb: () => Db) {}

  async create(input: CreateReminderScheduleInput): Promise<ReminderSchedule> {
    const db = this.getDb();
    const [row] = await db
      .insert(reminderSchedule)
      .values({
        userId: input.userId,
        category: input.category,
        label: input.label,
        times: input.times,
        daysOfWeek: input.daysOfWeek,
        weekInterval: input.weekInterval,
        anchorDate: input.anchorDate,
        enabled: input.enabled,
      })
      .returning();
    if (!row) throw new Error("failed to create reminder schedule");
    return toDomain(row);
  }

  async listByUser(userId: string): Promise<ReminderSchedule[]> {
    const db = this.getDb();
    const rows = await db.select().from(reminderSchedule).where(eq(reminderSchedule.userId, userId));
    return rows.map(toDomain);
  }

  async get(id: string): Promise<ReminderSchedule | null> {
    const db = this.getDb();
    const [row] = await db.select().from(reminderSchedule).where(eq(reminderSchedule.id, id)).limit(1);
    return row ? toDomain(row) : null;
  }

  async update(id: string, userId: string, patch: UpdateReminderSchedulePatch): Promise<ReminderSchedule | null> {
    const db = this.getDb();
    const values: Partial<typeof reminderSchedule.$inferInsert> = {};
    if (patch.label !== undefined) values.label = patch.label;
    if (patch.times !== undefined) values.times = patch.times;
    if (patch.daysOfWeek !== undefined) values.daysOfWeek = patch.daysOfWeek;
    if (patch.weekInterval !== undefined) values.weekInterval = patch.weekInterval;
    if (patch.anchorDate !== undefined) values.anchorDate = patch.anchorDate;
    if (patch.enabled !== undefined) values.enabled = patch.enabled;

    const [row] = await db
      .update(reminderSchedule)
      .set(values)
      .where(and(eq(reminderSchedule.id, id), eq(reminderSchedule.userId, userId)))
      .returning();
    return row ? toDomain(row) : null;
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const db = this.getDb();
    const deleted = await db
      .delete(reminderSchedule)
      .where(and(eq(reminderSchedule.id, id), eq(reminderSchedule.userId, userId)))
      .returning({ id: reminderSchedule.id });
    return deleted.length > 0;
  }

  async listActiveAll(): Promise<ActiveReminderSchedule[]> {
    const db = this.getDb();
    const rows = await db
      .select({ schedule: reminderSchedule, timezone: users.timezone })
      .from(reminderSchedule)
      .innerJoin(users, eq(reminderSchedule.userId, users.id))
      .where(eq(reminderSchedule.enabled, true));
    return rows.map((row) => ({ schedule: toDomain(row.schedule), timezone: row.timezone }));
  }
}
