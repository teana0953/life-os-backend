import type { FinanceCategoryRepository } from "../../../src/contexts/finance/domain/finance-category-repository";
import type {
  CreateFinanceCategoryInput,
  FinanceCategory,
  FinanceCategoryType,
  UpdateFinanceCategoryPatch,
} from "../../../src/contexts/finance/domain/finance-category";
import type { FinanceTransactionRepository } from "../../../src/contexts/finance/domain/finance-transaction-repository";
import type { CreateFinanceTransactionInput, FinanceTransaction, ReplaceFinanceTransactionInput } from "../../../src/contexts/finance/domain/finance-transaction";
import type { MonthlySummaryRaw } from "../../../src/contexts/finance/domain/monthly-summary";

/**
 * In-memory fake for unit tests. `insertDefaultsIfMissing` mirrors the real
 * adapter's `onConflictDoNothing` semantics (skip rows whose (userId, type,
 * name) already exists) without touching a database.
 */
export class InMemoryFinanceCategoryRepository implements FinanceCategoryRepository {
  categories: FinanceCategory[] = [];
  private nextId = 1;

  async listByUser(userId: string): Promise<FinanceCategory[]> {
    return this.categories.filter((c) => c.userId === userId).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async findById(id: string): Promise<FinanceCategory | null> {
    return this.categories.find((c) => c.id === id) ?? null;
  }

  async findByUserTypeName(userId: string, type: FinanceCategoryType, name: string): Promise<FinanceCategory | null> {
    return this.categories.find((c) => c.userId === userId && c.type === type && c.name === name) ?? null;
  }

  async create(input: CreateFinanceCategoryInput): Promise<FinanceCategory> {
    const category: FinanceCategory = {
      id: `category-${this.nextId++}`,
      userId: input.userId,
      name: input.name,
      type: input.type,
      icon: input.icon ?? "other",
      sortOrder: input.sortOrder ?? 0,
      archived: false,
    };
    this.categories.push(category);
    return category;
  }

  async update(userId: string, id: string, patch: UpdateFinanceCategoryPatch): Promise<FinanceCategory | null> {
    const category = this.categories.find((c) => c.id === id && c.userId === userId);
    if (!category) return null;
    if (patch.name !== undefined) category.name = patch.name;
    if (patch.icon !== undefined) category.icon = patch.icon;
    if (patch.sortOrder !== undefined) category.sortOrder = patch.sortOrder;
    if (patch.archived !== undefined) category.archived = patch.archived;
    return category;
  }

  async insertDefaultsIfMissing(defaults: CreateFinanceCategoryInput[]): Promise<void> {
    for (const d of defaults) {
      const exists = this.categories.some((c) => c.userId === d.userId && c.type === d.type && c.name === d.name);
      if (!exists) await this.create(d);
    }
  }
}

/** In-memory fake; `getMonthlySummaryRaw` mirrors the real adapter's SQL group-by (D5.1 in design.md). */
export class InMemoryFinanceTransactionRepository implements FinanceTransactionRepository {
  transactions: FinanceTransaction[] = [];
  private nextId = 1;

  async create(input: CreateFinanceTransactionInput): Promise<FinanceTransaction> {
    const txn: FinanceTransaction = {
      id: `txn-${this.nextId++}`,
      userId: input.userId,
      type: input.type,
      amount: input.amount,
      currency: input.currency,
      categoryId: input.categoryId,
      date: input.date,
      note: input.note ?? null,
    };
    this.transactions.push(txn);
    return txn;
  }

  async findById(id: string): Promise<FinanceTransaction | null> {
    return this.transactions.find((t) => t.id === id) ?? null;
  }

  async listByUserAndRange(userId: string, from: string, to: string): Promise<FinanceTransaction[]> {
    return this.transactions
      .filter((t) => t.userId === userId && t.date >= from && t.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async update(userId: string, id: string, input: ReplaceFinanceTransactionInput): Promise<FinanceTransaction | null> {
    const txn = this.transactions.find((t) => t.id === id && t.userId === userId);
    if (!txn) return null;
    txn.type = input.type;
    txn.amount = input.amount;
    txn.currency = input.currency;
    txn.categoryId = input.categoryId;
    txn.date = input.date;
    txn.note = input.note ?? null;
    return txn;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const idx = this.transactions.findIndex((t) => t.id === id && t.userId === userId);
    if (idx === -1) return false;
    this.transactions.splice(idx, 1);
    return true;
  }

  async getMonthlySummaryRaw(userId: string, month: string): Promise<MonthlySummaryRaw> {
    const rows = this.transactions.filter((t) => t.userId === userId && t.date.startsWith(month));

    const totalsMap = new Map<string, number>();
    const catMap = new Map<string, number>();
    for (const t of rows) {
      const totalsKey = `${t.currency}|${t.type}`;
      totalsMap.set(totalsKey, (totalsMap.get(totalsKey) ?? 0) + t.amount);
      const catKey = `${t.categoryId}|${t.type}|${t.currency}`;
      catMap.set(catKey, (catMap.get(catKey) ?? 0) + t.amount);
    }

    const totals = [...totalsMap.entries()].map(([key, amount]) => {
      const [currency, type] = key.split("|");
      return { currency, type: type as FinanceCategoryType, amount };
    });
    const byCategory = [...catMap.entries()].map(([key, amount]) => {
      const [categoryId, type, currency] = key.split("|");
      return { categoryId, type: type as FinanceCategoryType, currency, amount };
    });

    return { totals, byCategory };
  }
}
