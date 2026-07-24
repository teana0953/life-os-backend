import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "../../../shared/db/client";
import { careItem, careSchedule, users } from "../../../shared/db/schema";
import { isActiveOn } from "../domain/care-schedule";
import type {
  ActiveCareSchedule,
  ActiveScheduleForUser,
  CareCategory,
  CareItem,
  CareItemRepository,
  CareItemWithSchedules,
  CareSchedule,
  CareScheduleInput,
  CreateCareItemInput,
  UpdateCareItemPatch,
} from "../domain/care-item";

type CareItemRow = typeof careItem.$inferSelect;
type CareScheduleRow = typeof careSchedule.$inferSelect;

function itemToDomain(row: CareItemRow): CareItem {
  return {
    id: row.id,
    userId: row.userId,
    category: row.category as CareCategory,
    title: row.title,
    note: row.note,
    dose: row.dose,
    stock: row.stock,
    stockAlert: row.stockAlert,
  };
}

function scheduleToDomain(row: CareScheduleRow): CareSchedule {
  return {
    id: row.id,
    careItemId: row.careItemId,
    timeOfDay: row.timeOfDay,
    repeatDays: row.repeatDays,
    weekInterval: row.weekInterval,
    startDate: row.startDate,
    endDate: row.endDate,
    doseQuantity: row.doseQuantity,
    nagIntervalMinutes: row.nagIntervalMinutes,
    enabled: row.enabled,
  };
}

function scheduleInputToRow(
  userId: string,
  careItemId: string,
  s: CareScheduleInput,
): typeof careSchedule.$inferInsert {
  return {
    userId,
    careItemId,
    timeOfDay: s.timeOfDay,
    repeatDays: s.repeatDays,
    weekInterval: s.weekInterval,
    startDate: s.startDate,
    endDate: s.endDate ?? null,
    doseQuantity: s.doseQuantity,
    nagIntervalMinutes: s.nagIntervalMinutes,
    enabled: s.enabled,
  };
}

/** Driven adapter: implements CareItemRepository via Drizzle + Neon. */
export class DrizzleCareItemRepository implements CareItemRepository {
  constructor(private readonly getDb: () => Db) {}

  async create(input: CreateCareItemInput): Promise<CareItemWithSchedules> {
    const db = this.getDb();
    const [itemRow] = await db
      .insert(careItem)
      .values({
        userId: input.userId,
        category: input.category,
        title: input.title,
        note: input.note ?? null,
        dose: input.dose ?? null,
        stock: input.stock ?? null,
        stockAlert: input.stockAlert ?? null,
      })
      .returning();
    if (!itemRow) throw new Error("failed to create care item");

    let scheduleRows: CareScheduleRow[] = [];
    if (input.schedules.length > 0) {
      scheduleRows = await db
        .insert(careSchedule)
        .values(input.schedules.map((s) => scheduleInputToRow(input.userId, itemRow.id, s)))
        .returning();
    }

    return { ...itemToDomain(itemRow), schedules: scheduleRows.map(scheduleToDomain) };
  }

  async listByUser(userId: string, category?: CareCategory): Promise<CareItemWithSchedules[]> {
    const db = this.getDb();
    const items = await db
      .select()
      .from(careItem)
      .where(category ? and(eq(careItem.userId, userId), eq(careItem.category, category)) : eq(careItem.userId, userId));
    if (items.length === 0) return [];

    const schedules = await db
      .select()
      .from(careSchedule)
      .where(
        inArray(
          careSchedule.careItemId,
          items.map((i) => i.id),
        ),
      );
    const byItem = new Map<string, CareScheduleRow[]>();
    for (const s of schedules) {
      const list = byItem.get(s.careItemId) ?? [];
      list.push(s);
      byItem.set(s.careItemId, list);
    }

    return items.map((i) => ({ ...itemToDomain(i), schedules: (byItem.get(i.id) ?? []).map(scheduleToDomain) }));
  }

  async get(id: string): Promise<CareItemWithSchedules | null> {
    const db = this.getDb();
    const [itemRow] = await db.select().from(careItem).where(eq(careItem.id, id)).limit(1);
    if (!itemRow) return null;
    const schedules = await db.select().from(careSchedule).where(eq(careSchedule.careItemId, id));
    return { ...itemToDomain(itemRow), schedules: schedules.map(scheduleToDomain) };
  }

  async getByScheduleId(scheduleId: string): Promise<CareItemWithSchedules | null> {
    const db = this.getDb();
    const [scheduleRow] = await db.select().from(careSchedule).where(eq(careSchedule.id, scheduleId)).limit(1);
    if (!scheduleRow) return null;
    return this.get(scheduleRow.careItemId);
  }

  async update(id: string, userId: string, patch: UpdateCareItemPatch): Promise<CareItemWithSchedules | null> {
    const db = this.getDb();

    const itemValues: Partial<typeof careItem.$inferInsert> = {};
    if (patch.category !== undefined) itemValues.category = patch.category;
    if (patch.title !== undefined) itemValues.title = patch.title;
    if (patch.note !== undefined) itemValues.note = patch.note;
    if (patch.dose !== undefined) itemValues.dose = patch.dose;
    if (patch.stock !== undefined) itemValues.stock = patch.stock;
    if (patch.stockAlert !== undefined) itemValues.stockAlert = patch.stockAlert;

    let itemRow: CareItemRow | undefined;
    if (Object.keys(itemValues).length > 0) {
      [itemRow] = await db
        .update(careItem)
        .set(itemValues)
        .where(and(eq(careItem.id, id), eq(careItem.userId, userId)))
        .returning();
      if (!itemRow) return null;
    } else {
      [itemRow] = await db
        .select()
        .from(careItem)
        .where(and(eq(careItem.id, id), eq(careItem.userId, userId)))
        .limit(1);
      if (!itemRow) return null;
    }

    // Upsert schedules by id (D2 in design.md): update existing rows in place,
    // insert new ones — a patch schedule whose `id` is absent OR doesn't match
    // an existing row for this item is treated as new (inserted), never
    // silently dropped — delete only the ones this patch omits — never
    // delete-and-reinsert, so care_log/care_occurrence history (FK
    // care_schedule_id) survives an item edit. The update/insert/delete
    // statements are batched into one atomic round-trip (`db.batch`, the
    // neon-http driver's transaction primitive — `db.transaction` is
    // unsupported over its HTTP protocol) so a mid-sequence failure never
    // leaves a partial schedule set.
    if (patch.schedules !== undefined) {
      const existingRows = await db.select({ id: careSchedule.id }).from(careSchedule).where(eq(careSchedule.careItemId, id));
      const existingIds = new Set(existingRows.map((r) => r.id));
      const matchedIds = new Set<string>();

      const mutations: BatchItem<"pg">[] = patch.schedules.map((s) => {
        if (s.id && existingIds.has(s.id)) {
          matchedIds.add(s.id);
          return db
            .update(careSchedule)
            .set(scheduleInputToRow(userId, id, s))
            .where(and(eq(careSchedule.id, s.id), eq(careSchedule.careItemId, id)));
        }
        return db.insert(careSchedule).values(scheduleInputToRow(userId, id, s));
      });

      const deleteIds = [...existingIds].filter((existingId) => !matchedIds.has(existingId));
      if (deleteIds.length > 0) {
        mutations.push(db.delete(careSchedule).where(and(eq(careSchedule.careItemId, id), inArray(careSchedule.id, deleteIds))));
      }

      if (mutations.length > 0) {
        const [first, ...rest] = mutations;
        await db.batch([first, ...rest]);
      }
    }

    const schedules = await db.select().from(careSchedule).where(eq(careSchedule.careItemId, id));
    return { ...itemToDomain(itemRow), schedules: schedules.map(scheduleToDomain) };
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const db = this.getDb();
    const deleted = await db
      .delete(careItem)
      .where(and(eq(careItem.id, id), eq(careItem.userId, userId)))
      .returning({ id: careItem.id });
    return deleted.length > 0;
  }

  async listActiveSchedules(): Promise<ActiveCareSchedule[]> {
    const db = this.getDb();
    const rows = await db
      .select({ item: careItem, schedule: careSchedule, timezone: users.timezone })
      .from(careSchedule)
      .innerJoin(careItem, eq(careSchedule.careItemId, careItem.id))
      .innerJoin(users, eq(careItem.userId, users.id))
      .where(eq(careSchedule.enabled, true));
    return rows.map((row) => ({
      item: itemToDomain(row.item),
      schedule: scheduleToDomain(row.schedule),
      timezone: row.timezone,
    }));
  }

  async listActiveSchedulesForUserOn(userId: string, localDate: string): Promise<ActiveScheduleForUser[]> {
    const db = this.getDb();
    const rows = await db
      .select({ item: careItem, schedule: careSchedule })
      .from(careSchedule)
      .innerJoin(careItem, eq(careSchedule.careItemId, careItem.id))
      .where(and(eq(careItem.userId, userId), eq(careSchedule.enabled, true)));

    return rows
      .map((row) => ({ item: itemToDomain(row.item), schedule: scheduleToDomain(row.schedule) }))
      .filter((row) => isActiveOn(row.schedule, localDate))
      .sort((a, b) => a.schedule.timeOfDay.localeCompare(b.schedule.timeOfDay) || a.item.title.localeCompare(b.item.title));
  }

  async decrementStock(itemId: string, amount: number): Promise<void> {
    const db = this.getDb();
    await db
      .update(careItem)
      .set({ stock: sql`GREATEST(${careItem.stock} - ${amount}, 0)` })
      .where(and(eq(careItem.id, itemId), isNotNull(careItem.stock)));
  }
}
