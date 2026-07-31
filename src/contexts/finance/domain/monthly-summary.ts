import type { FinanceCategoryType } from "./finance-category";

/**
 * The raw per-(currency, type) and per-(category, type, currency) sums for a
 * user's month, as computed by the repository's SQL group-by. The
 * `expense`/`income`/`net` shape returned to callers is derived from this by
 * the `getMonthlySummary` use case, NOT by the repository (design.md).
 */
export interface RawCurrencyTypeTotal {
  currency: string;
  type: FinanceCategoryType;
  amount: number;
}

export interface CategoryAmount {
  categoryId: string;
  type: FinanceCategoryType;
  currency: string;
  amount: number;
}

export interface MonthlySummaryRaw {
  totals: RawCurrencyTypeTotal[];
  byCategory: CategoryAmount[];
}

export interface CurrencyTotal {
  currency: string;
  expense: number;
  income: number;
  net: number;
}

export interface MonthlySummary {
  month: string;
  totals: CurrencyTotal[];
  byCategory: CategoryAmount[];
}
