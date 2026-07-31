import type { Context } from "hono";
import { createCategory } from "../../../contexts/finance/application/create-category";
import { createTransaction } from "../../../contexts/finance/application/create-transaction";
import { deleteTransaction } from "../../../contexts/finance/application/delete-transaction";
import { getMonthlySummary } from "../../../contexts/finance/application/get-monthly-summary";
import { listCategories } from "../../../contexts/finance/application/list-categories";
import { listTransactions } from "../../../contexts/finance/application/list-transactions";
import { updateCategory } from "../../../contexts/finance/application/update-category";
import { updateTransaction } from "../../../contexts/finance/application/update-transaction";
import { DEFAULT_CURRENCY } from "../../../contexts/finance/domain/currency";
import {
  FinanceCategoryArchived,
  FinanceCategoryNotFound,
  FinanceCategoryTypeMismatch,
  FinanceTransactionNotFound,
  InvalidFinanceInputError,
} from "../../../contexts/finance/domain/errors";
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
}

/**
 * Maps this route's typed domain errors to the app's error boundary
 * primitives (same pattern as the menstrual route's `InvalidPeriodError`
 * catch): NotFound errors become an explicit 404 `{ "error": "not_found" }`;
 * every other typed error becomes a `BadRequestError`, which the app's
 * central `onError` turns into 400.
 */
function mapFinanceError(err: unknown, c: Context): Response {
  if (err instanceof FinanceCategoryNotFound || err instanceof FinanceTransactionNotFound) {
    return c.json({ error: "not_found" }, 404);
  }
  if (err instanceof FinanceCategoryArchived || err instanceof FinanceCategoryTypeMismatch || err instanceof InvalidFinanceInputError) {
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
      const transaction = await createTransaction(options.financeCategoryRepository, options.financeTransactionRepository, {
        userId,
        type: requireString(body.type, "type") as "expense" | "income",
        amount: requireFiniteNumber(body.amount, "amount"),
        currency: typeof body.currency === "string" ? body.currency : DEFAULT_CURRENCY,
        categoryId: requireString(body.category_id, "category_id"),
        date: requireDay(body.date, "date"),
        note: optionalNote(body),
      });
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
      const transaction = await updateTransaction(options.financeCategoryRepository, options.financeTransactionRepository, userId, c.req.param("id") ?? "", {
        type: requireString(body.type, "type") as "expense" | "income",
        amount: requireFiniteNumber(body.amount, "amount"),
        currency: requireString(body.currency, "currency"),
        categoryId: requireString(body.category_id, "category_id"),
        date: requireDay(body.date, "date"),
        note: optionalNote(body),
      });
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
