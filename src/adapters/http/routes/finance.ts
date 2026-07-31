import type { Context } from "hono";
import { createCategory } from "../../../contexts/finance/application/create-category";
import { createTransaction } from "../../../contexts/finance/application/create-transaction";
import { deleteBudget } from "../../../contexts/finance/application/delete-budget";
import { deleteTransaction } from "../../../contexts/finance/application/delete-transaction";
import { getMonthlySummary } from "../../../contexts/finance/application/get-monthly-summary";
import { listBudgetsWithProgress } from "../../../contexts/finance/application/list-budgets-with-progress";
import { listCategories } from "../../../contexts/finance/application/list-categories";
import { listTransactions } from "../../../contexts/finance/application/list-transactions";
import { updateCategory } from "../../../contexts/finance/application/update-category";
import { updateTransaction } from "../../../contexts/finance/application/update-transaction";
import { upsertBudget } from "../../../contexts/finance/application/upsert-budget";
import type { BudgetAlertNotifier } from "../../../contexts/finance/domain/budget-alert-notifier";
import { DEFAULT_CURRENCY } from "../../../contexts/finance/domain/currency";
import { createNetWorthAccount } from "../../../contexts/finance/application/create-networth-account";
import { getMonthlyNetWorth } from "../../../contexts/finance/application/get-monthly-networth";
import { getNetWorthTrend } from "../../../contexts/finance/application/get-networth-trend";
import { listNetWorthAccounts } from "../../../contexts/finance/application/list-networth-accounts";
import { updateNetWorthAccount } from "../../../contexts/finance/application/update-networth-account";
import { upsertNetWorthSnapshot } from "../../../contexts/finance/application/upsert-networth-snapshot";
import {
  FinanceBudgetNotFound,
  FinanceCategoryArchived,
  FinanceCategoryNotFound,
  FinanceCategoryTypeMismatch,
  FinanceTransactionNotFound,
  InvalidFinanceInputError,
} from "../../../contexts/finance/domain/errors";
import {
  NetWorthAccountArchived,
  NetWorthAccountNameConflict,
  NetWorthAccountNotFound,
} from "../../../contexts/finance/domain/networth-errors";
import type { NetWorthAccount } from "../../../contexts/finance/domain/networth-account";
import type { NetWorthRepository } from "../../../contexts/finance/domain/networth-repository";
import type { MonthlyNetWorth } from "../../../contexts/finance/application/get-monthly-networth";
import type { NetWorthAccountValue, NetWorthTrendPoint } from "../../../contexts/finance/domain/networth-snapshot";
import type { BudgetProgress, FinanceBudget } from "../../../contexts/finance/domain/finance-budget";
import type { FinanceBudgetRepository } from "../../../contexts/finance/domain/finance-budget-repository";
import type { FinanceCategory } from "../../../contexts/finance/domain/finance-category";
import type { FinanceCategoryRepository } from "../../../contexts/finance/domain/finance-category-repository";
import type { FinanceTransaction } from "../../../contexts/finance/domain/finance-transaction";
import type { FinanceTransactionRepository } from "../../../contexts/finance/domain/finance-transaction-repository";
import type { CategoryAmount, CurrencyTotal } from "../../../contexts/finance/domain/monthly-summary";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import { BadRequestError, requireDay, requireFiniteNumber, requireMonth, requireString } from "../validation";

export interface FinanceHandlerOptions {
  userRepository: UserRepository;
  financeCategoryRepository: FinanceCategoryRepository;
  financeTransactionRepository: FinanceTransactionRepository;
  financeBudgetRepository: FinanceBudgetRepository;
  financeNetWorthRepository: NetWorthRepository;
  budgetAlertNotifier: BudgetAlertNotifier;
}

/**
 * Maps this route's typed domain errors to the app's error boundary
 * primitives (same pattern as the menstrual route's `InvalidPeriodError`
 * catch): NotFound errors become an explicit 404 `{ "error": "not_found" }`;
 * every other typed error becomes a `BadRequestError`, which the app's
 * central `onError` turns into 400.
 */
function mapFinanceError(err: unknown, c: Context): Response {
  if (
    err instanceof FinanceCategoryNotFound ||
    err instanceof FinanceTransactionNotFound ||
    err instanceof FinanceBudgetNotFound ||
    err instanceof NetWorthAccountNotFound
  ) {
    return c.json({ error: "not_found" }, 404);
  }
  if (
    err instanceof FinanceCategoryArchived ||
    err instanceof FinanceCategoryTypeMismatch ||
    err instanceof InvalidFinanceInputError ||
    err instanceof NetWorthAccountArchived ||
    err instanceof NetWorthAccountNameConflict
  ) {
    throw new BadRequestError(err.message);
  }
  throw err;
}

function transactionToJson(txn: FinanceTransaction) {
  return {
    id: txn.id,
    type: txn.type,
    amount: txn.amount,
    currency: txn.currency,
    category_id: txn.categoryId,
    date: txn.date,
    note: txn.note,
  };
}

function categoryToJson(category: FinanceCategory) {
  return {
    id: category.id,
    name: category.name,
    type: category.type,
    icon: category.icon,
    sort_order: category.sortOrder,
    archived: category.archived,
  };
}

function totalToJson(total: CurrencyTotal) {
  return { currency: total.currency, expense: total.expense, income: total.income, net: total.net };
}

function categoryAmountToJson(amount: CategoryAmount) {
  return { category_id: amount.categoryId, type: amount.type, currency: amount.currency, amount: amount.amount };
}

function budgetToJson(budget: FinanceBudget) {
  return { id: budget.id, category_id: budget.categoryId, amount: budget.amount };
}

function budgetProgressToJson(progress: BudgetProgress) {
  return { id: progress.id, category_id: progress.categoryId, amount: progress.amount, spent: progress.spent, remaining: progress.remaining, percent: progress.percent };
}

/** `category_id` on a budget PUT: absent/`null` -> the overall budget, a string -> that category; anything else -> 400. */
function budgetCategoryId(body: Record<string, unknown>): string | null {
  const value = body.category_id;
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  throw new BadRequestError("category_id must be a string or null");
}

function budgetAlertDeps(options: FinanceHandlerOptions) {
  return { budgetRepository: options.financeBudgetRepository, categoryRepository: options.financeCategoryRepository, notifier: options.budgetAlertNotifier };
}

/** Optional `note` field, present-key three-state: absent -> undefined, `null` -> null, string -> string; anything else -> 400. */
function optionalNote(body: Record<string, unknown>): string | null | undefined {
  if (!("note" in body)) return undefined;
  const value = body.note;
  if (value === null) return null;
  if (typeof value === "string") return value;
  throw new BadRequestError("note must be a string or null");
}

/** Protected `GET /api/finance/transactions?from=&to=`: the user's transactions in the (required) date range. */
export function createListTransactionsHandler(options: FinanceHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const from = requireDay(c.req.query("from"), "from");
    const to = requireDay(c.req.query("to"), "to");
    const transactions = await listTransactions(options.financeTransactionRepository, userId, from, to);
    return c.json({ transactions: transactions.map(transactionToJson) });
  };
}

/** Protected `POST /api/finance/transactions`: create a transaction (currency defaults to TWD). */
export function createCreateTransactionHandler(options: FinanceHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    try {
      const transaction = await createTransaction(
        options.financeCategoryRepository,
        options.financeTransactionRepository,
        {
          userId,
          type: requireString(body.type, "type") as "expense" | "income",
          amount: requireFiniteNumber(body.amount, "amount"),
          currency: typeof body.currency === "string" ? body.currency : DEFAULT_CURRENCY,
          categoryId: requireString(body.category_id, "category_id"),
          date: requireDay(body.date, "date"),
          note: optionalNote(body),
        },
        budgetAlertDeps(options),
      );
      return c.json(transactionToJson(transaction));
    } catch (err) {
      return mapFinanceError(err, c);
    }
  };
}

/** Protected `PUT /api/finance/transactions/:id`: full-replace update of an owned transaction (`currency` required). */
export function createUpdateTransactionHandler(options: FinanceHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    try {
      const transaction = await updateTransaction(
        options.financeCategoryRepository,
        options.financeTransactionRepository,
        userId,
        c.req.param("id") ?? "",
        {
          type: requireString(body.type, "type") as "expense" | "income",
          amount: requireFiniteNumber(body.amount, "amount"),
          currency: requireString(body.currency, "currency"),
          categoryId: requireString(body.category_id, "category_id"),
          date: requireDay(body.date, "date"),
          note: optionalNote(body),
        },
        budgetAlertDeps(options),
      );
      return c.json(transactionToJson(transaction));
    } catch (err) {
      return mapFinanceError(err, c);
    }
  };
}

/** Protected `DELETE /api/finance/transactions/:id`: delete an owned transaction. */
export function createDeleteTransactionHandler(options: FinanceHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    try {
      await deleteTransaction(options.financeTransactionRepository, userId, c.req.param("id") ?? "");
      return c.json({ deleted: true });
    } catch (err) {
      return mapFinanceError(err, c);
    }
  };
}

/** Protected `GET /api/finance/categories`: the user's categories, lazily seeding the defaults on first call. */
export function createListCategoriesHandler(options: FinanceHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const categories = await listCategories(options.financeCategoryRepository, userId);
    return c.json({ categories: categories.map(categoryToJson) });
  };
}

/** Protected `POST /api/finance/categories`: create a category. */
export function createCreateCategoryHandler(options: FinanceHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    try {
      const category = await createCategory(options.financeCategoryRepository, {
        userId,
        name: requireString(body.name, "name"),
        type: requireString(body.type, "type") as "expense" | "income",
        icon: typeof body.icon === "string" ? body.icon : undefined,
        sortOrder: typeof body.sort_order === "number" ? body.sort_order : undefined,
      });
      return c.json(categoryToJson(category));
    } catch (err) {
      return mapFinanceError(err, c);
    }
  };
}

/** Protected `PUT /api/finance/categories/:id`: partial-update an owned category (name/icon/sort_order/archived; `type` is not editable). */
export function createUpdateCategoryHandler(options: FinanceHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    try {
      const category = await updateCategory(options.financeCategoryRepository, userId, c.req.param("id") ?? "", {
        name: typeof body.name === "string" ? body.name : undefined,
        icon: typeof body.icon === "string" ? body.icon : undefined,
        sortOrder: typeof body.sort_order === "number" ? body.sort_order : undefined,
        archived: typeof body.archived === "boolean" ? body.archived : undefined,
      });
      return c.json(categoryToJson(category));
    } catch (err) {
      return mapFinanceError(err, c);
    }
  };
}

/** Protected `GET /api/finance/summary?month=YYYY-MM`: per-currency expense/income/net totals and per-category amounts. */
export function createGetSummaryHandler(options: FinanceHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const month = requireMonth(c.req.query("month"));
    const summary = await getMonthlySummary(options.financeTransactionRepository, userId, month);
    return c.json({
      month: summary.month,
      totals: summary.totals.map(totalToJson),
      by_category: summary.byCategory.map(categoryAmountToJson),
    });
  };
}

/** Protected `GET /api/finance/budgets?month=YYYY-MM`: every budget with that month's spent/remaining/percent. */
export function createGetBudgetsHandler(options: FinanceHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const month = requireMonth(c.req.query("month"));
    try {
      const budgets = await listBudgetsWithProgress(options.financeBudgetRepository, userId, month);
      return c.json({ month, budgets: budgets.map(budgetProgressToJson) });
    } catch (err) {
      return mapFinanceError(err, c);
    }
  };
}

/** Protected `PUT /api/finance/budgets`: upsert one budget (`category_id` null = overall, else that category). */
export function createUpsertBudgetHandler(options: FinanceHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    try {
      const budget = await upsertBudget(options.financeCategoryRepository, options.financeBudgetRepository, {
        userId,
        categoryId: budgetCategoryId(body),
        amount: requireFiniteNumber(body.amount, "amount"),
      });
      return c.json(budgetToJson(budget));
    } catch (err) {
      return mapFinanceError(err, c);
    }
  };
}

/** Protected `DELETE /api/finance/budgets/:id`: delete an owned budget (its alerts cascade). */
export function createDeleteBudgetHandler(options: FinanceHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    try {
      await deleteBudget(options.financeBudgetRepository, userId, c.req.param("id") ?? "");
      return c.json({ deleted: true });
    } catch (err) {
      return mapFinanceError(err, c);
    }
  };
}

function networthAccountToJson(account: NetWorthAccount) {
  return { id: account.id, kind: account.kind, name: account.name, sort_order: account.sortOrder, archived: account.archived };
}

function networthAccountValueToJson(value: NetWorthAccountValue) {
  return { account_id: value.accountId, kind: value.kind, name: value.name, value: value.value };
}

function networthTrendPointToJson(point: NetWorthTrendPoint) {
  return { month: point.month, net_worth: point.netWorth };
}

function monthlyNetWorthToJson(result: MonthlyNetWorth) {
  return {
    month: result.month,
    accounts: result.accounts.map(networthAccountValueToJson),
    total_asset: result.totalAsset,
    total_liability: result.totalLiability,
    net_worth: result.netWorth,
    prev_net_worth: result.prevNetWorth,
    growth_rate: result.growthRate,
  };
}

/** Protected `GET /api/finance/networth/accounts`: the user's net-worth accounts, lazily seeding the defaults on first call. */
export function createListNetWorthAccountsHandler(options: FinanceHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const accounts = await listNetWorthAccounts(options.financeNetWorthRepository, userId);
    return c.json({ accounts: accounts.map(networthAccountToJson) });
  };
}

/** Protected `POST /api/finance/networth/accounts`: create a net-worth account (`kind` fixed at creation). */
export function createCreateNetWorthAccountHandler(options: FinanceHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    try {
      const account = await createNetWorthAccount(options.financeNetWorthRepository, {
        userId,
        kind: requireString(body.kind, "kind") as NetWorthAccount["kind"],
        name: requireString(body.name, "name"),
        sortOrder: typeof body.sort_order === "number" ? body.sort_order : undefined,
      });
      return c.json(networthAccountToJson(account));
    } catch (err) {
      return mapFinanceError(err, c);
    }
  };
}

/** Protected `PUT /api/finance/networth/accounts/:id`: partial-update an owned account (name/sort_order/archived; `kind` is not editable). */
export function createUpdateNetWorthAccountHandler(options: FinanceHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    try {
      const account = await updateNetWorthAccount(options.financeNetWorthRepository, userId, c.req.param("id") ?? "", {
        name: typeof body.name === "string" ? body.name : undefined,
        sortOrder: typeof body.sort_order === "number" ? body.sort_order : undefined,
        archived: typeof body.archived === "boolean" ? body.archived : undefined,
      });
      return c.json(networthAccountToJson(account));
    } catch (err) {
      return mapFinanceError(err, c);
    }
  };
}

/** Protected `PUT /api/finance/networth/snapshots`: upsert one (account, month) market-value snapshot. */
export function createUpsertNetWorthSnapshotHandler(options: FinanceHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    try {
      const snapshot = await upsertNetWorthSnapshot(options.financeNetWorthRepository, {
        userId,
        accountId: requireString(body.account_id, "account_id"),
        month: requireMonth(body.month),
        value: requireFiniteNumber(body.value, "value"),
      });
      return c.json({ id: snapshot.id, account_id: snapshot.accountId, month: snapshot.month, value: snapshot.value });
    } catch (err) {
      return mapFinanceError(err, c);
    }
  };
}

/** Protected `GET /api/finance/networth?month=YYYY-MM`: the month's account values, net worth, and growth rate. */
export function createGetNetWorthHandler(options: FinanceHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const month = requireMonth(c.req.query("month"));
    const result = await getMonthlyNetWorth(options.financeNetWorthRepository, userId, month);
    return c.json(monthlyNetWorthToJson(result));
  };
}

/** Protected `GET /api/finance/networth/trend?from=YYYY-MM&to=YYYY-MM`: the per-month net-worth series (ascending). */
export function createGetNetWorthTrendHandler(options: FinanceHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const from = requireMonth(c.req.query("from"), "from");
    const to = requireMonth(c.req.query("to"), "to");
    const points = await getNetWorthTrend(options.financeNetWorthRepository, userId, from, to);
    return c.json({ points: points.map(networthTrendPointToJson) });
  };
}
