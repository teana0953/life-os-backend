import { beforeEach, describe, expect, it } from "vitest";
import { createTransaction } from "../../../../src/contexts/finance/application/create-transaction";
import { updateTransaction } from "../../../../src/contexts/finance/application/update-transaction";
import { deleteTransaction } from "../../../../src/contexts/finance/application/delete-transaction";
import { listTransactions } from "../../../../src/contexts/finance/application/list-transactions";
import {
  FinanceCategoryArchived,
  FinanceCategoryNotFound,
  FinanceCategoryTypeMismatch,
  FinanceTransactionNotFound,
  InvalidFinanceInputError,
} from "../../../../src/contexts/finance/domain/errors";
import { InMemoryFinanceCategoryRepository, InMemoryFinanceTransactionRepository } from "../fakes";

let categories: InMemoryFinanceCategoryRepository;
let transactions: InMemoryFinanceTransactionRepository;

beforeEach(() => {
  categories = new InMemoryFinanceCategoryRepository();
  transactions = new InMemoryFinanceTransactionRepository();
});

async function seedCategory(overrides: Partial<{ userId: string; type: "expense" | "income"; name: string }> = {}) {
  return categories.create({
    userId: overrides.userId ?? "user-1",
    name: overrides.name ?? "餐飲",
    type: overrides.type ?? "expense",
  });
}

describe("createTransaction", () => {
  it("stores and returns a valid expense transaction", async () => {
    const category = await seedCategory();
    const txn = await createTransaction(categories, transactions, {
      userId: "user-1",
      type: "expense",
      amount: 300,
      currency: "TWD",
      categoryId: category.id,
      date: "2026-07-15",
    });
    expect(txn).toMatchObject({ type: "expense", amount: 300, currency: "TWD", categoryId: category.id, date: "2026-07-15" });
    expect(transactions.transactions).toHaveLength(1);
  });

  it("rejects amount <= 0", async () => {
    const category = await seedCategory();
    await expect(
      createTransaction(categories, transactions, {
        userId: "user-1",
        type: "expense",
        amount: 0,
        currency: "TWD",
        categoryId: category.id,
        date: "2026-07-15",
      }),
    ).rejects.toBeInstanceOf(InvalidFinanceInputError);
    expect(transactions.transactions).toHaveLength(0);
  });

  it("rejects a non-integer amount", async () => {
    const category = await seedCategory();
    await expect(
      createTransaction(categories, transactions, {
        userId: "user-1",
        type: "expense",
        amount: 12.5,
        currency: "TWD",
        categoryId: category.id,
        date: "2026-07-15",
      }),
    ).rejects.toBeInstanceOf(InvalidFinanceInputError);
  });

  it("rejects a currency outside the whitelist", async () => {
    const category = await seedCategory();
    await expect(
      createTransaction(categories, transactions, {
        userId: "user-1",
        type: "expense",
        amount: 100,
        currency: "XYZ",
        categoryId: category.id,
        date: "2026-07-15",
      }),
    ).rejects.toBeInstanceOf(InvalidFinanceInputError);
  });

  it("rejects a missing/unknown category_id as 404-mapped FinanceCategoryNotFound", async () => {
    await expect(
      createTransaction(categories, transactions, {
        userId: "user-1",
        type: "expense",
        amount: 100,
        currency: "TWD",
        categoryId: "nope",
        date: "2026-07-15",
      }),
    ).rejects.toBeInstanceOf(FinanceCategoryNotFound);
  });

  it("rejects another user's category as FinanceCategoryNotFound", async () => {
    const category = await seedCategory({ userId: "user-2" });
    await expect(
      createTransaction(categories, transactions, {
        userId: "user-1",
        type: "expense",
        amount: 100,
        currency: "TWD",
        categoryId: category.id,
        date: "2026-07-15",
      }),
    ).rejects.toBeInstanceOf(FinanceCategoryNotFound);
  });

  it("rejects a type/category-type mismatch as FinanceCategoryTypeMismatch", async () => {
    const incomeCategory = await seedCategory({ type: "income", name: "薪資" });
    await expect(
      createTransaction(categories, transactions, {
        userId: "user-1",
        type: "expense",
        amount: 100,
        currency: "TWD",
        categoryId: incomeCategory.id,
        date: "2026-07-15",
      }),
    ).rejects.toBeInstanceOf(FinanceCategoryTypeMismatch);
  });

  it("rejects an archived category (always, on create)", async () => {
    const category = await seedCategory();
    await categories.update("user-1", category.id, { archived: true });
    await expect(
      createTransaction(categories, transactions, {
        userId: "user-1",
        type: "expense",
        amount: 100,
        currency: "TWD",
        categoryId: category.id,
        date: "2026-07-15",
      }),
    ).rejects.toBeInstanceOf(FinanceCategoryArchived);
  });
});

describe("updateTransaction", () => {
  it("replaces amount/note while keeping the same category", async () => {
    const category = await seedCategory();
    const txn = await createTransaction(categories, transactions, {
      userId: "user-1",
      type: "expense",
      amount: 100,
      currency: "TWD",
      categoryId: category.id,
      date: "2026-07-15",
    });
    const updated = await updateTransaction(categories, transactions, "user-1", txn.id, {
      type: "expense",
      amount: 250,
      currency: "TWD",
      categoryId: category.id,
      date: "2026-07-16",
      note: "lunch",
    });
    expect(updated).toMatchObject({ amount: 250, date: "2026-07-16", note: "lunch" });
  });

  it("returns 404-mapped FinanceTransactionNotFound for another user's transaction", async () => {
    const category = await seedCategory();
    const txn = await createTransaction(categories, transactions, {
      userId: "user-1",
      type: "expense",
      amount: 100,
      currency: "TWD",
      categoryId: category.id,
      date: "2026-07-15",
    });
    await expect(
      updateTransaction(categories, transactions, "user-2", txn.id, {
        type: "expense",
        amount: 200,
        currency: "TWD",
        categoryId: category.id,
        date: "2026-07-15",
      }),
    ).rejects.toBeInstanceOf(FinanceTransactionNotFound);
  });

  it("returns FinanceTransactionNotFound for an unknown id", async () => {
    await expect(
      updateTransaction(categories, transactions, "user-1", "nope", {
        type: "expense",
        amount: 200,
        currency: "TWD",
        categoryId: "irrelevant",
        date: "2026-07-15",
      }),
    ).rejects.toBeInstanceOf(FinanceTransactionNotFound);
  });

  it("rejects switching a transaction onto an archived category", async () => {
    const category = await seedCategory();
    const archivedCategory = await seedCategory({ name: "娛樂" });
    await categories.update("user-1", archivedCategory.id, { archived: true });
    const txn = await createTransaction(categories, transactions, {
      userId: "user-1",
      type: "expense",
      amount: 100,
      currency: "TWD",
      categoryId: category.id,
      date: "2026-07-15",
    });
    await expect(
      updateTransaction(categories, transactions, "user-1", txn.id, {
        type: "expense",
        amount: 100,
        currency: "TWD",
        categoryId: archivedCategory.id,
        date: "2026-07-15",
      }),
    ).rejects.toBeInstanceOf(FinanceCategoryArchived);
  });

  it("allows editing amount/note/date when the category is unchanged, even though it's since been archived", async () => {
    const category = await seedCategory();
    const txn = await createTransaction(categories, transactions, {
      userId: "user-1",
      type: "expense",
      amount: 100,
      currency: "TWD",
      categoryId: category.id,
      date: "2026-07-15",
    });
    await categories.update("user-1", category.id, { archived: true });

    const updated = await updateTransaction(categories, transactions, "user-1", txn.id, {
      type: "expense",
      amount: 150,
      currency: "TWD",
      categoryId: category.id,
      date: "2026-07-16",
      note: "still editable",
    });
    expect(updated).toMatchObject({ amount: 150, date: "2026-07-16", note: "still editable" });
  });

  it("rejects a missing currency-equivalent (invalid) value on full-replace update", async () => {
    const category = await seedCategory();
    const txn = await createTransaction(categories, transactions, {
      userId: "user-1",
      type: "expense",
      amount: 100,
      currency: "TWD",
      categoryId: category.id,
      date: "2026-07-15",
    });
    await expect(
      updateTransaction(categories, transactions, "user-1", txn.id, {
        type: "expense",
        amount: 100,
        currency: "NOTREAL",
        categoryId: category.id,
        date: "2026-07-15",
      }),
    ).rejects.toBeInstanceOf(InvalidFinanceInputError);
  });
});

describe("deleteTransaction", () => {
  it("deletes an owned transaction", async () => {
    const category = await seedCategory();
    const txn = await createTransaction(categories, transactions, {
      userId: "user-1",
      type: "expense",
      amount: 100,
      currency: "TWD",
      categoryId: category.id,
      date: "2026-07-15",
    });
    await deleteTransaction(transactions, "user-1", txn.id);
    expect(transactions.transactions).toHaveLength(0);
  });

  it("throws FinanceTransactionNotFound for another user's transaction, leaving it intact", async () => {
    const category = await seedCategory();
    const txn = await createTransaction(categories, transactions, {
      userId: "user-1",
      type: "expense",
      amount: 100,
      currency: "TWD",
      categoryId: category.id,
      date: "2026-07-15",
    });
    await expect(deleteTransaction(transactions, "user-2", txn.id)).rejects.toBeInstanceOf(FinanceTransactionNotFound);
    expect(transactions.transactions).toHaveLength(1);
  });
});

describe("listTransactions", () => {
  it("returns only the user's transactions within the date range", async () => {
    const category = await seedCategory();
    await createTransaction(categories, transactions, {
      userId: "user-1",
      type: "expense",
      amount: 100,
      currency: "TWD",
      categoryId: category.id,
      date: "2026-07-01",
    });
    await createTransaction(categories, transactions, {
      userId: "user-1",
      type: "expense",
      amount: 200,
      currency: "TWD",
      categoryId: category.id,
      date: "2026-08-01",
    });
    const otherCategory = await seedCategory({ userId: "user-2" });
    await createTransaction(categories, transactions, {
      userId: "user-2",
      type: "expense",
      amount: 300,
      currency: "TWD",
      categoryId: otherCategory.id,
      date: "2026-07-15",
    });

    const result = await listTransactions(transactions, "user-1", "2026-07-01", "2026-07-31");
    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe(100);
  });
});
