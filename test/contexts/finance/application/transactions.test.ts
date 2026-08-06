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
  MirroredTransactionChangedUnderneath,
} from "../../../../src/contexts/finance/domain/errors";
import type { FinanceTransaction } from "../../../../src/contexts/finance/domain/finance-transaction";
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

/**
 * The window inside `updateTransaction` itself: it reads the row, compares the
 * split's facts against the body, then writes a full replace — and the payer's
 * split edit can commit in between. Nothing above this layer can stage that
 * interleaving, because the read being raced is this use case's own; the HTTP
 * cases cannot reach it. Overriding `findById` to hand back a **snapshot** and
 * then let the split edit land is exactly the real sequence: a `SELECT` returns
 * values, not a live row.
 */
class RacingTransactionRepository extends InMemoryFinanceTransactionRepository {
  private raced = false;

  constructor(private readonly splitEditCommits: () => void) {
    super();
  }

  override async findById(id: string): Promise<FinanceTransaction | null> {
    const row = await super.findById(id);
    // Snapshot *before* the edit lands: the caller is holding values read a
    // moment ago, which is the whole premise. Taken after, the use case's own
    // value comparison would see the new amount and reject on that instead —
    // the test would pass while proving nothing about the write.
    const snapshot = row === null ? null : { ...row };
    if (!this.raced) {
      this.raced = true;
      this.splitEditCommits();
    }
    return snapshot;
  }
}

describe("updateTransaction racing a split edit", () => {
  it("refuses to write values the split has already moved past", async () => {
    // Read-then-full-replace with no lock and no version column: the holder
    // read amount 900, the payer's edit made it 1200, and an unconditional
    // write would put 900 back. The ledger would then say 900 and the split
    // 1200, permanently and with no error — the very divergence the
    // read-only rule exists to prevent, reached through the one edit the API
    // allows. The write has to be conditional on the values that were
    // compared.
    const racing = new RacingTransactionRepository(() => {
      const row = racing.transactions[0];
      row.amount = 1200;
    });
    const food = await seedCategory();
    const fun = await seedCategory({ name: "娛樂" });
    const mirror = await racing.create({
      userId: "user-1",
      type: "expense",
      amount: 900,
      currency: "TWD",
      categoryId: food.id,
      date: "2026-07-15",
      splitExpenseId: "split-1",
      categorySource: "mirror",
    });

    await expect(
      updateTransaction(categories, racing, "user-1", mirror.id, {
        type: "expense",
        amount: 900,
        currency: "TWD",
        categoryId: fun.id,
        date: "2026-07-15",
      }),
    ).rejects.toBeInstanceOf(MirroredTransactionChangedUnderneath);

    // Nothing of the caller's write landed — not even the category, which on
    // its own would have been allowed.
    expect(racing.transactions[0]).toMatchObject({ amount: 1200, categoryId: food.id, categorySource: "mirror" });
  });

  it("still writes when nothing raced it", async () => {
    // The other half: the predicate must not reject an ordinary edit. Without
    // this, "always refuse" would pass the case above.
    const quiet = new RacingTransactionRepository(() => {});
    const food = await seedCategory();
    const fun = await seedCategory({ name: "娛樂" });
    const mirror = await quiet.create({
      userId: "user-1",
      type: "expense",
      amount: 900,
      currency: "TWD",
      categoryId: food.id,
      date: "2026-07-15",
      splitExpenseId: "split-1",
      categorySource: "mirror",
    });

    const updated = await updateTransaction(categories, quiet, "user-1", mirror.id, {
      type: "expense",
      amount: 900,
      currency: "TWD",
      categoryId: fun.id,
      date: "2026-07-15",
    });

    expect(updated).toMatchObject({ amount: 900, categoryId: fun.id, categorySource: "manual" });
  });

  it("answers 'not found', not 'changed underneath', when the split was deleted", async () => {
    // A no-match has two causes and they are not the same answer: the row
    // moved on (retry and it may work) or the payer deleted the split and the
    // cascade took the row with it (retrying never will). Without this, the
    // re-read that tells them apart can be dropped for a blanket conflict and
    // nothing notices.
    const vanishing = new RacingTransactionRepository(() => {
      vanishing.transactions.length = 0;
    });
    const food = await seedCategory();
    const fun = await seedCategory({ name: "娛樂" });
    const mirror = await vanishing.create({
      userId: "user-1",
      type: "expense",
      amount: 900,
      currency: "TWD",
      categoryId: food.id,
      date: "2026-07-15",
      splitExpenseId: "split-1",
      categorySource: "mirror",
    });

    await expect(
      updateTransaction(categories, vanishing, "user-1", mirror.id, {
        type: "expense",
        amount: 900,
        currency: "TWD",
        categoryId: fun.id,
        date: "2026-07-15",
      }),
    ).rejects.toBeInstanceOf(FinanceTransactionNotFound);
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

  it("hides another user's mirrored transaction behind the same 404, rather than refusing it as a mirror", async () => {
    // The ownership half of the guard is invisible on an ordinary row: the
    // repository's delete is owner-scoped, so dropping it still ends in
    // `FinanceTransactionNotFound`. A *mirror* is where it matters — without
    // the ownership check the mirror check runs first and answers
    // `MirroredTransactionReadOnly`, telling a stranger that this id exists
    // and that it is somebody's split. Isolation says another user's row is
    // indistinguishable from a missing one.
    const category = await seedCategory({ userId: "user-1" });
    const txn = await transactions.create({
      userId: "user-1",
      type: "expense",
      amount: 900,
      currency: "TWD",
      categoryId: category.id,
      date: "2026-07-15",
      splitExpenseId: "split-1",
      categorySource: "mirror",
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
