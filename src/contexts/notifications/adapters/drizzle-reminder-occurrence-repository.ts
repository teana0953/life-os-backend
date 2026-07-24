import { and, eq, lte } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { reminderOccurrence } from "../../../shared/db/schema";
import type {
  CreateReminderOccurrenceInput,
  ReminderOccurrence,
  ReminderOccurrenceRepository,
} from "../domain/reminder-occurrence";

type ReminderOccurrenceRow = typeof reminderOccurrence.$inferSelect;

function toDomain(row: ReminderOccurrenceRow): ReminderOccurrence {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    dueAt: row.dueAt,
    title: row.title,
    body: row.body,
    status: row.status,
    dedupeKey: row.dedupeKey,
  };
}

/** Driven adapter: implements ReminderOccurrenceRepository via Drizzle + Neon. */
export class DrizzleReminderOccurrenceRepository implements ReminderOccurrenceRepository {
  constructor(private readonly getDb: () => Db) {}

  async upsertByDedupeKey(input: CreateReminderOccurrenceInput): Promise<ReminderOccurrence> {
    const db = this.getDb();
    const [created] = await db
      .insert(reminderOccurrence)
      .values({
        userId: input.userId,
        kind: input.kind,
        dueAt: input.dueAt,
        title: input.title,
        body: input.body,
        dedupeKey: input.dedupeKey,
      })
      .onConflictDoNothing({ target: reminderOccurrence.dedupeKey })
      .returning();
    if (created) return toDomain(created);

    // Already materialized by an earlier or overlapping tick (D2/D6 in design.md).
    const [existing] = await db
      .select()
      .from(reminderOccurrence)
      .where(eq(reminderOccurrence.dedupeKey, input.dedupeKey))
      .limit(1);
    if (!existing) throw new Error("failed to upsert reminder occurrence");
    return toDomain(existing);
  }

  async listDuePending(now: Date): Promise<ReminderOccurrence[]> {
    const db = this.getDb();
    const rows = await db
      .select()
      .from(reminderOccurrence)
      .where(and(eq(reminderOccurrence.status, "pending"), lte(reminderOccurrence.dueAt, now)));
    return rows.map(toDomain);
  }

  private async setStatus(id: string, status: "sent" | "skipped" | "failed"): Promise<void> {
    const db = this.getDb();
    await db
      .update(reminderOccurrence)
      .set({ status, sentAt: status === "sent" ? new Date() : undefined })
      .where(eq(reminderOccurrence.id, id));
  }

  async markSent(id: string): Promise<void> {
    await this.setStatus(id, "sent");
  }

  async markSkipped(id: string): Promise<void> {
    await this.setStatus(id, "skipped");
  }

  async markFailed(id: string): Promise<void> {
    await this.setStatus(id, "failed");
  }
}
