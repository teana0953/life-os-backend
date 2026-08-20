import type { Context } from "hono";
import type { CheckBudgetAlertsDeps } from "../../../contexts/finance/application/check-budget-alerts";
import { createCategory } from "../../../contexts/finance/application/create-category";
import { createInstallmentPlan } from "../../../contexts/finance/application/create-installment-plan";
import type { InstallmentDeps } from "../../../contexts/finance/application/create-installment-plan";
import { settleInstallmentPlan } from "../../../contexts/finance/application/settle-installment-plan";
import { updateInstallmentPlan } from "../../../contexts/finance/application/update-installment-plan";
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
import { DEFAULT_CURRENCY, isSupportedCurrency } from "../../../contexts/finance/domain/currency";
import { createNetWorthAccount } from "../../../contexts/finance/application/create-networth-account";
import { getMonthlyNetWorth } from "../../../contexts/finance/application/get-monthly-networth";
import { getNetWorthTrend } from "../../../contexts/finance/application/get-networth-trend";
import { listNetWorthAccounts } from "../../../contexts/finance/application/list-networth-accounts";
import { reorderNetWorthAccounts } from "../../../contexts/finance/application/reorder-networth-accounts";
import { updateNetWorthAccount } from "../../../contexts/finance/application/update-networth-account";
import { upsertNetWorthSnapshot } from "../../../contexts/finance/application/upsert-networth-snapshot";
import {
  FinanceBudgetNotFound,
  FinanceCategoryArchived,
  FinanceCategoryNotFound,
  FinanceCategoryTypeMismatch,
  FinanceTransactionNotFound,
  InstallmentPlanNotFound,
  InvalidFinanceInputError,
  MirroredTransactionChangedUnderneath,
  MirroredTransactionReadOnly,
} from "../../../contexts/finance/domain/errors";
import type { InstallmentPlan } from "../../../contexts/finance/domain/installment-plan";
import type { InstallmentPlanRepository } from "../../../contexts/finance/domain/installment-plan-repository";
import {
  NetWorthAccountArchived,
  NetWorthAccountNameConflict,
  NetWorthAccountNotFound,
  NetWorthAccountOrderMismatch,
  NetWorthInvalidKind,
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
// Split spending (add-settle-up): a read-time aggregation of the user's own
// split-expense shares, surfaced alongside finance's own summary without
// changing its response shape (design.md).
import { getSplitSpending } from "../../../contexts/split/application/get-split-spending";
import type { SplitSpendingAmount } from "../../../contexts/split/domain/split-spending";
import type { SplitSpendingRepository } from "../../../contexts/split/domain/split-spending-repository";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import { BadRequestError, requireDay, requireFiniteNumber, requireMonth, requireString, requireStringArray } from "../validation";

export interface FinanceHandlerOptions {
  userRepository: UserRepository;
  financeCategoryRepository: FinanceCategoryRepository;
  financeTransactionRepository: FinanceTransactionRepository;
  financeBudgetRepository: FinanceBudgetRepository;
  financeNetWorthRepository: NetWorthRepository;
  installmentPlanRepository: InstallmentPlanRepository;
  budgetAlertNotifier: BudgetAlertNotifier;
  splitSpendingRepository: SplitSpendingRepository;
}

/**
 * Maps this route's typed domain errors to the app's error boundary
 * primitives (same pattern as the menstrual route's `InvalidPeriodError`
 * catch): NotFound errors become an explicit 404 `{ "error": "not_found" }`;
 * a lost race against a split edit becomes an explicit 409
 * `{ "error": "conflict" }`; every other typed error becomes a
 * `BadRequestError`, which the app's central `onError` turns into 400.
 */
function mapFinanceError(err: unknown, c: Context): Response {
  if (
    err instanceof FinanceCategoryNotFound ||
    err instanceof FinanceTransactionNotFound ||
    err instanceof FinanceBudgetNotFound ||
    err instanceof NetWorthAccountNotFound ||
    err instanceof InstallmentPlanNotFound
  ) {
    return c.json({ error: "not_found" }, 404);
  }
  // 409, not 400: the request was valid when it was made, and re-sending it
  // against the row as it now stands may well succeed. A client cannot tell
  // "retry with fresh data" from "this edit is never allowed" if both are 400.
  if (err instanceof MirroredTransactionChangedUnderneath) {
    return c.json({ error: "conflict" }, 409);
  }
  if (
    err instanceof FinanceCategoryArchived ||
    err instanceof FinanceCategoryTypeMismatch ||
    err instanceof InvalidFinanceInputError ||
    err instanceof MirroredTransactionReadOnly ||
    err instanceof NetWorthAccountArchived ||
    err instanceof NetWorthAccountNameConflict ||
    err instanceof NetWorthAccountOrderMismatch ||
    err instanceof NetWorthInvalidKind
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
    // Present on every transaction, not just mirrored ones, so a client can
    // tell them apart without a second call and lock the fields the finance
    // API will refuse to change anyway.
    split_expense_id: txn.splitExpenseId,
    category_source: txn.categorySource,
    // Present on every transaction, null off a plan (add-installments
    // design.md D6d) — alongside `GET /api/finance/installment-plans/:id` for
    // the period count/mode/start month a client needs but a single
    // transaction row cannot carry.
    plan_id: txn.planId ?? null,
    installment_no: txn.installmentNo ?? null,
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

/** The budgets response body; shared with the home-summary batch section so the two cannot drift. */
export function budgetsToJson(month: string, budgets: BudgetProgress[]) {
  return { month, budgets: budgets.map(budgetProgressToJson) };
}

/** `category_id` on a budget PUT: absent/`null` -> the overall budget, a string -> that category; anything else -> 400. */
function budgetCategoryId(body: Record<string, unknown>): string | null {
  const value = body.category_id;
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  throw new BadRequestError("category_id must be a string or null");
}

/**
 * `now`/`getUserTimezone` are what let `checkBudgetAlerts` apply its
 * "month ≤ the user's today" gate (add-installments design.md D4b) — without
 * them the check behaves as before (no month gating at all). This matters
 * beyond installment routes: an instalment is an ordinary transaction
 * (design.md D2), so editing one goes through the very same
 * `PUT /api/finance/transactions/:id` route as any other edit (tasks 0b.1c).
 */
function budgetAlertDeps(options: FinanceHandlerOptions): CheckBudgetAlertsDeps {
  return {
    budgetRepository: options.financeBudgetRepository,
    categoryRepository: options.financeCategoryRepository,
    notifier: options.budgetAlertNotifier,
    now: () => new Date(),
    getUserTimezone: async (userId: string) => (await options.userRepository.getById(userId))?.timezone ?? "Asia/Taipei",
  };
}

/** Same clock/timezone contract as `budgetAlertDeps` — "today" for the due/upcoming boundary is the user's own (design.md D5). */
function installmentDeps(options: FinanceHandlerOptions): InstallmentDeps {
  return {
    planRepository: options.installmentPlanRepository,
    categoryRepository: options.financeCategoryRepository,
    now: () => new Date(),
    getUserTimezone: async (userId: string) => (await options.userRepository.getById(userId))?.timezone ?? "Asia/Taipei",
  };
}

/** period count, creation mode, and start month, on top of the plan_id/installment_no already on every transaction — what a client needs to render "instalment N of M" and to know whether settling it should prompt for an amount (design.md D6d). */
function installmentPlanToJson(plan: InstallmentPlan) {
  return {
    id: plan.id,
    mode: plan.mode,
    periods: plan.periods,
    start_day: plan.startDay,
    amount: plan.amount,
    currency: plan.currency,
    category_id: plan.categoryId,
    note: plan.note,
  };
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

/** `mode` on an instalment-plan write: only the two the domain knows (design.md D0/D2). */
function requireInstallmentMode(value: unknown): "total" | "per_installment" {
  if (value === "total" || value === "per_installment") return value;
  throw new BadRequestError('mode must be "total" or "per_installment"');
}

/** Protected `POST /api/finance/installment-plans`: create a plan and write every one of its instalments (design.md D1/D3/D4). */
export function createCreateInstallmentPlanHandler(options: FinanceHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    try {
      const plan = await createInstallmentPlan(
        installmentDeps(options),
        {
          userId,
          mode: requireInstallmentMode(body.mode),
          amount: requireFiniteNumber(body.amount, "amount"),
          periods: requireFiniteNumber(body.periods, "periods"),
          currency: typeof body.currency === "string" ? body.currency : DEFAULT_CURRENCY,
          categoryId: requireString(body.category_id, "category_id"),
          startDay: requireDay(body.start_day, "start_day"),
          note: optionalNote(body),
        },
        budgetAlertDeps(options),
      );
      return c.json(installmentPlanToJson(plan));
    } catch (err) {
      return mapFinanceError(err, c);
    }
  };
}

/** Protected `GET /api/finance/installment-plans/:id`: the period count, creation mode and start month a client needs (design.md D6d) — the finance API never leaks a wrong-owner 404 vs 403 distinction. */
export function createGetInstallmentPlanHandler(options: FinanceHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const plan = await options.installmentPlanRepository.findById(c.req.param("id") ?? "");
    if (!plan || plan.userId !== userId) return c.json({ error: "not_found" }, 404);
    return c.json(installmentPlanToJson(plan));
  };
}

/** Protected `PUT /api/finance/installment-plans/:id`: rewrite the instalments still to come (design.md D2b/D5). */
export function createUpdateInstallmentPlanHandler(options: FinanceHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    try {
      await updateInstallmentPlan(
        installmentDeps(options),
        {
          userId,
          planId: c.req.param("id") ?? "",
          amount: requireFiniteNumber(body.amount, "amount"),
          periods: requireFiniteNumber(body.periods, "periods"),
        },
        budgetAlertDeps(options),
      );
      const plan = await options.installmentPlanRepository.findById(c.req.param("id") ?? "");
      return c.json(plan ? installmentPlanToJson(plan) : { updated: true });
    } catch (err) {
      return mapFinanceError(err, c);
    }
  };
}

/** Protected `POST /api/finance/installment-plans/:id/settle`: replace the instalments still to come with one transaction dated today (design.md D6). `amount` is required for a `per_installment` plan (the bank's payoff figure) and ignored for `total` (computed from what remains, D2b). */
export function createSettleInstallmentPlanHandler(options: FinanceHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    try {
      await settleInstallmentPlan(
        installmentDeps(options),
        {
          userId,
          planId: c.req.param("id") ?? "",
          amount: typeof body.amount === "number" ? body.amount : undefined,
        },
        budgetAlertDeps(options),
      );
      return c.json({ settled: true });
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

/**
 * `counted_in_transactions` says whether this currency's shares are already
 * in the caller's transactions, i.e. in the monthly summary and every budget
 * (design.md D11). It is per currency because that is where the two answers
 * diverge: a whitelisted currency is mirrored and adding this figure to the
 * summary would double-count it, while an unwhitelisted one is *only* here.
 * Stating it in the response rather than in a document is the point — a
 * client cannot infer finance's whitelist.
 */
function splitSpendingAmountToJson(amount: SplitSpendingAmount) {
  return { currency: amount.currency, amount: amount.amount, counted_in_transactions: isSupportedCurrency(amount.currency) };
}

/**
 * Protected `GET /api/finance/split-spending?month=YYYY-MM`: the caller's own
 * split-expense shares that month, per currency — a read-time aggregation
 * that is never folded into `/api/finance/summary` (design.md: that
 * response's shape must not change, since clients already read it). A month
 * with no split shares answers an empty `totals` array, not a zero row per
 * currency.
 */
export function createGetSplitSpendingHandler(options: FinanceHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const month = requireMonth(c.req.query("month"));
    const totals = await getSplitSpending(options.splitSpendingRepository, userId, month);
    return c.json({ month, totals: totals.map(splitSpendingAmountToJson) });
  };
}

/** Protected `GET /api/finance/budgets?month=YYYY-MM`: every budget with that month's spent/remaining/percent. */
export function createGetBudgetsHandler(options: FinanceHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const month = requireMonth(c.req.query("month"));
    try {
      const budgets = await listBudgetsWithProgress(options.financeBudgetRepository, userId, month);
      return c.json(budgetsToJson(month, budgets));
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

/** The monthly net-worth body; shared with the home-summary batch section so the two cannot drift. */
export function monthlyNetWorthToJson(result: MonthlyNetWorth) {
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

/**
 * Protected `PUT /api/finance/networth/accounts/order`: atomically reorder all
 * of the user's accounts of one `kind` (issue #80). `ids` must be exactly the
 * user's account ids of that `kind`, including archived ones; must be
 * registered before `PUT /accounts/:id` or `/accounts/order` matches that
 * route with `id="order"`.
 */
export function createReorderNetWorthAccountsHandler(options: FinanceHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    try {
      const kind = requireString(body.kind, "kind") as NetWorthAccount["kind"];
      const ids = requireStringArray(body.ids, "ids");
      await reorderNetWorthAccounts(options.financeNetWorthRepository, userId, kind, ids);
      return c.json({ reordered: true });
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
