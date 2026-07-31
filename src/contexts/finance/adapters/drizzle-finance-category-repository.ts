import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { financeCategory } from "../../../shared/db/schema";
import type { CreateFinanceCategoryInput, FinanceCategory, FinanceCategoryType, UpdateFinanceCategoryPatch } from "../domain/finance-category";
import type { FinanceCategoryRepository } from "../domain/finance-category-repository";

type FinanceCategoryRow = typeof financeCategory.$inferSelect;

function toDomain(row: FinanceCategoryRow): FinanceCategory {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    type: row.type as FinanceCategoryType,
    icon: row.icon,
    sortOrder: row.sortOrder,
    archived: row.archived,
  };
}

/** Driven adapter: implements FinanceCategoryRepository via Drizzle + Neon. */
export class DrizzleFinanceCategoryRepository implements FinanceCategoryRepository {
  constructor(private readonly getDb: () => Db) {}

  async listByUser(userId: string): Promise<FinanceCategory[]> {
    const db = this.getDb();
    const rows = await db
      .select()
      .from(financeCategory)
      .where(eq(financeCategory.userId, userId))
      .orderBy(asc(financeCategory.sortOrder));
    return rows.map(toDomain);
  }

  async findById(id: string): Promise<FinanceCategory | null> {
    const db = this.getDb();
    const [row] = await db.select().from(financeCategory).where(eq(financeCategory.id, id)).limit(1);
    return row ? toDomain(row) : null;
  }

  async findByUserTypeName(userId: string, type: FinanceCategoryType, name: string): Promise<FinanceCategory | null> {
    const db = this.getDb();
    const [row] = await db
      .select()
      .from(financeCategory)
      .where(and(eq(financeCategory.userId, userId), eq(financeCategory.type, type), eq(financeCategory.name, name)))
      .limit(1);
    return row ? toDomain(row) : null;
  }

  async create(input: CreateFinanceCategoryInput): Promise<FinanceCategory> {
    const db = this.getDb();
    const [row] = await db
      .insert(financeCategory)
      .values({
        userId: input.userId,
        name: input.name,
        type: input.type,
        icon: input.icon ?? "other",
        sortOrder: input.sortOrder ?? 0,
      })
      .returning();
    if (!row) throw new Error("failed to create finance category");
    return toDomain(row);
  }

  async update(userId: string, id: string, patch: UpdateFinanceCategoryPatch): Promise<FinanceCategory | null> {
    const db = this.getDb();
    // `updatedAt` has `defaultNow()` but that only fires on insert; every update sets it explicitly.
    const values: Partial<typeof financeCategory.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.icon !== undefined) values.icon = patch.icon;
    if (patch.sortOrder !== undefined) values.sortOrder = patch.sortOrder;
    if (patch.archived !== undefined) values.archived = patch.archived;

    const [row] = await db
      .update(financeCategory)
      .set(values)
      .where(and(eq(financeCategory.id, id), eq(financeCategory.userId, userId)))
      .returning();
    return row ? toDomain(row) : null;
  }

  async insertDefaultsIfMissing(defaults: CreateFinanceCategoryInput[]): Promise<void> {
    if (defaults.length === 0) return;
    const db = this.getDb();
    await db
      .insert(financeCategory)
      .values(
        defaults.map((d) => ({
          userId: d.userId,
          name: d.name,
          type: d.type,
          icon: d.icon ?? "other",
          sortOrder: d.sortOrder ?? 0,
        })),
      )
      // The (user_id, type, name) unique index makes this the concurrency
      // safety net behind ensureDefaultCategories' "seed only if empty" check.
      .onConflictDoNothing();
  }
}
