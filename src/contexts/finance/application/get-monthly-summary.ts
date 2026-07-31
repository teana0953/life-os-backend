import type { FinanceTransactionRepository } from "../domain/finance-transaction-repository";
import type { CurrencyTotal, MonthlySummary } from "../domain/monthly-summary";

/**
 * Use case: the user's monthly summary. The repository returns raw
 * per-(currency, type) and per-(category, type, currency) sums (its SQL
 * group-by); this use case derives the `expense`/`income`/`net`-per-currency
 * shape from those raw totals — the netting is application logic, not SQL.
 */
export async function getMonthlySummary(repository: FinanceTransactionRepository, userId: string, month: string): Promise<MonthlySummary> {
  const raw = await repository.getMonthlySummaryRaw(userId, month);

  const byCurrency = new Map<string, { expense: number; income: number }>();
  for (const t of raw.totals) {
    const entry = byCurrency.get(t.currency) ?? { expense: 0, income: 0 };
    if (t.type === "expense") entry.expense += t.amount;
    else entry.income += t.amount;
    byCurrency.set(t.currency, entry);
  }

  const totals: CurrencyTotal[] = [...byCurrency.entries()].map(([currency, { expense, income }]) => ({
    currency,
    expense,
    income,
    net: income - expense,
  }));

  return { month, totals, byCategory: raw.byCategory };
}
