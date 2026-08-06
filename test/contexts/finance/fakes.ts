import type { BudgetAlertMessage, BudgetAlertNotifier } from "../../../src/contexts/finance/domain/budget-alert-notifier";
import type { FinanceCategoryRepository } from "../../../src/contexts/finance/domain/finance-category-repository";
import type {
  CreateFinanceCategoryInput,
  FinanceCategory,
  FinanceCategoryType,
  UpdateFinanceCategoryPatch,
} from "../../../src/contexts/finance/domain/finance-category";
import type { FinanceTransactionRepository } from "../../../src/contexts/finance/domain/finance-transaction-repository";
import type {
  CreateFinanceTransactionInput,
  FinanceTransaction,
  SplitFactsSnapshot,
  UpdateFinanceTransactionFields,
} from "../../../src/contexts/finance/domain/finance-transaction";
import type { FinanceBudget, UpsertFinanceBudgetInput } from "../../../src/contexts/finance/domain/finance-budget";
import type { BudgetWithSpent, FinanceBudgetRepository, TryRecordAlertInput } from "../../../src/contexts/finance/domain/finance-budget-repository";
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
      splitExpenseId: input.splitExpenseId ?? null,
      categorySource: input.categorySource ?? "manual",
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

  async update(userId: string, id: string, input: UpdateFinanceTransactionFields, expected?: SplitFactsSnapshot): Promise<FinanceTransaction | null> {
    const txn = this.transactions.find((t) => t.id === id && t.userId === userId);
    if (!txn) return null;
    // The adapter folds these into the statement's WHERE; here they are the
    // same condition on the same row. Not matching means a split edit landed
    // between the caller's read and this write (D7).
    if (expected && (txn.type !== expected.type || txn.amount !== expected.amount || txn.currency !== expected.currency || txn.date !== expected.date)) {
      return null;
    }
    txn.type = input.type;
    txn.amount = input.amount;
    txn.currency = input.currency;
    txn.categoryId = input.categoryId;
    txn.date = input.date;
    txn.note = input.note ?? null;
    // `splitExpenseId` is deliberately never assigned: the real adapter leaves
    // that column out of its SET list too (D17). `categorySource` follows the
    // adapter the other way — written only when the use case supplies it.
    if (input.categorySource !== undefined) txn.categorySource = input.categorySource;
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

/**
 * In-memory fake; `spentFor` mirrors the real adapter's SQL scoping (TWD
 * expense only, `date` within `month`, category-scoped or all-categories for
 * the overall budget) by reading straight from an injected transactions fake
 * — the real repository does this join in SQL instead.
 */
export class InMemoryFinanceBudgetRepository implements FinanceBudgetRepository {
  budgets: FinanceBudget[] = [];
  alerts: TryRecordAlertInput[] = [];
  private nextId = 1;

  constructor(private readonly transactions: InMemoryFinanceTransactionRepository) {}

  async upsert(input: UpsertFinanceBudgetInput): Promise<FinanceBudget> {
    const existing = this.budgets.find((b) => b.userId === input.userId && b.categoryId === input.categoryId);
    if (existing) {
      existing.amount = input.amount;
      return existing;
    }
    const budget: FinanceBudget = { id: `budget-${this.nextId++}`, userId: input.userId, categoryId: input.categoryId, amount: input.amount };
    this.budgets.push(budget);
    return budget;
  }

  async findByUserAndCategory(userId: string, categoryId: string | null): Promise<FinanceBudget | null> {
    return this.budgets.find((b) => b.userId === userId && b.categoryId === categoryId) ?? null;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const idx = this.budgets.findIndex((b) => b.id === id && b.userId === userId);
    if (idx === -1) return false;
    const [removed] = this.budgets.splice(idx, 1);
    // Mirrors the real FK cascade: drop this budget's alerts too.
    this.alerts = this.alerts.filter((a) => a.budgetId !== removed.id);
    return true;
  }

  private spentFor(userId: string, categoryId: string | null, month: string): number {
    return this.transactions.transactions
      .filter(
        (t) =>
          t.userId === userId &&
          t.type === "expense" &&
          t.currency === "TWD" &&
          t.date.startsWith(month) &&
          (categoryId === null || t.categoryId === categoryId),
      )
      .reduce((sum, t) => sum + t.amount, 0);
  }

  async listWithSpent(userId: string, month: string): Promise<BudgetWithSpent[]> {
    return this.budgets.filter((b) => b.userId === userId).map((budget) => ({ budget, spent: this.spentFor(userId, budget.categoryId, month) }));
  }

  async getSpent(userId: string, categoryId: string | null, month: string): Promise<number> {
    return this.spentFor(userId, categoryId, month);
  }

  async tryRecordAlert(input: TryRecordAlertInput): Promise<boolean> {
    const exists = this.alerts.some((a) => a.budgetId === input.budgetId && a.month === input.month && a.threshold === input.threshold);
    if (exists) return false;
    this.alerts.push({ ...input });
    return true;
  }
}

/** In-memory fake notifier; records every message and optionally runs a hook (e.g. to simulate a push failure). */
export class FakeBudgetAlertNotifier implements BudgetAlertNotifier {
  messages: { userId: string; message: BudgetAlertMessage }[] = [];

  constructor(private readonly onNotify?: (userId: string, message: BudgetAlertMessage) => Promise<void> | void) {}

  async notify(userId: string, message: BudgetAlertMessage): Promise<void> {
    this.messages.push({ userId, message });
    if (this.onNotify) await this.onNotify(userId, message);
  }
}
