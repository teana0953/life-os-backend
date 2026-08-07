import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { DrizzleBalanceRepository } from "../../src/contexts/split/adapters/drizzle-balance-repository";
import { DrizzleSplitExpenseRepository } from "../../src/contexts/split/adapters/drizzle-split-expense-repository";
import type { ShareMirrorRow } from "../../src/contexts/split/domain/shares-mirror";
import type { CreateSplitExpenseInput, SplitShareInput } from "../../src/contexts/split/domain/split-expense";
import { financeTransaction } from "../../src/shared/db/schema";
import { createTestDb, insertCategory, insertUser, type TestDb } from "./harness";

/**
 * split-installments tasks 3.2 / 3.3 / 4.3 / 5.4 against a real Postgres.
 *
 * RED PHASE: every case here writes a scheduled share the way the finished
 * feature will — one mirror row **per period**, all carrying the same
 * `(user_id, split_expense_id)` — which today collides with the
 * `finance_transaction_user_split_expense_idx` unique index (one mirror per
 * user per split). That collision is task 5.1's identity-key change
 * (`(user_id, split_expense_id, installment_no)`), so the leading
 * `expect(...).resolves` in each case is an assertion on the future contract,
 * not scaffolding.
 *
 * **Why the balance assertions insist the row EXISTS, not just what it says**
 * (tasks 0.2 / 3.2): `drizzle-balance-repository.ts` ends in
 * `HAVING SUM(...) != 0`, so a balance mutated to count only the periods
 * already due doesn't report zero — the row vanishes wholesale. An assertion
 * on the amount alone cannot tell "row missing" from "amount is zero";
 * `expect(row).toBeDefined()` can.
 *
 * Statement counting follows `installments.test.ts`: neon-http's `db.batch`
 * statement limit is unknowable, so the only safe property is that the
 * statement count does not grow with the period count — and 360 periods is
 * what makes that assertion mean something (a 3-period fixture also passes
 * under one-statement-per-period).
 */

const A = "11111111-1111-1111-1111-111111111111"; // payer
const B = "22222222-2222-2222-2222-222222222222"; // holder on a schedule
const C = "33333333-3333-3333-3333-333333333333"; // holder with no schedule
const E1 = "e1111111-1111-1111-1111-111111111111";
const E2 = "e2222222-2222-2222-2222-222222222222";
const CAT_B = "cb000001-0000-0000-0000-000000000000";
const CAT_C = "cc000001-0000-0000-0000-000000000000";

/** A share on a repayment schedule. The cast is the red-phase seam: `schedule` does not exist on `SplitShareInput` yet. */
function scheduledShare(userId: string, amount: number, periods: number, perPeriodAmount: number): SplitShareInput {
  return { userId, amount, schedule: { periods, perPeriodAmount } } as SplitShareInput;
}

/**
 * The holder's mirrors as the finished `SharesMirror.plan` will hand them
 * over: one row per period, monthly days, 1-based `installmentNo` — the third
 * component of the future identity key. Day-of-month 15 keeps clamping out of
 * these fixtures; the anchoring rule has its own test at the plan layer.
 */
function installmentMirrors(
  userId: string,
  categoryId: string,
  splitExpenseId: string,
  opts: { periods: number; amount: number; startYear: number; startMonth?: number },
): ShareMirrorRow[] {
  return Array.from({ length: opts.periods }, (_, i) => {
    const monthIndex = (opts.startMonth ?? 1) - 1 + i;
    const year = opts.startYear + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    return {
      userId,
      splitExpenseId,
      amount: opts.amount,
      currency: "TWD",
      categoryId,
      day: `${year}-${String(month).padStart(2, "0")}-15`,
      note: "scheduled repayment",
      installmentNo: i + 1,
    } as ShareMirrorRow;
  });
}

/// Every mirror row a holder has for one expense, in period order.
async function mirrorsOf(userId: string, expenseId: string) {
  const rows = await harness.db
    .select()
    .from(financeTransaction)
    .where(and(eq(financeTransaction.userId, userId), eq(financeTransaction.splitExpenseId, expenseId)));
  return rows.sort((x, y) => (x.installmentNo ?? 0) - (y.installmentNo ?? 0));
}

function createInput(overrides: Partial<CreateSplitExpenseInput>): CreateSplitExpenseInput {
  return {
    id: E1,
    groupId: null,
    payerUserId: A,
    // Deliberately not the payer — same reason as the harness helpers: with
    // the two equal, swapping the columns anywhere stays invisible.
    createdByUserId: B,
    amount: 6000,
    currency: "TWD",
    description: "annual fee",
    day: "2030-01-15",
    splitMode: "exact",
    categoryName: null,
    shares: [scheduledShare(B, 6000, 12, 500)],
    ...overrides,
  };
}

let harness: TestDb;
let expenses: DrizzleSplitExpenseRepository;
let balances: DrizzleBalanceRepository;
const statements: string[] = [];

const touchesTransactions = (sql: string) => sql.includes('"finance_transaction"');
const isInsert = (sql: string) => /insert\s+into/i.test(sql);

beforeAll(async () => {
  harness = await createTestDb({ onQuery: (sql) => statements.push(sql) });
  expenses = new DrizzleSplitExpenseRepository(() => harness.db);
  balances = new DrizzleBalanceRepository(() => harness.db);
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.resetDb();
  await insertUser(harness.db, A, "a@example.com", "Ann");
  await insertUser(harness.db, B, "b@example.com", "Ben");
  await insertUser(harness.db, C, "c@example.com", "Cid");
  await insertCategory(harness.db, { id: CAT_B, userId: B, name: "其他" });
  await insertCategory(harness.db, { id: CAT_C, userId: C, name: "其他" });
  statements.length = 0;
});

describe("the balance ignores the schedule (3.2, 3.3)", () => {
  it("a freshly scheduled debt with no period due yet is owed in full — and the row exists (3.2)", async () => {
    // Every period is in 2030: nothing is due at any realistic run date.
    await expect(
      expenses.create(createInput({}), installmentMirrors(B, CAT_B, E1, { periods: 12, amount: 500, startYear: 2030 })),
    ).resolves.toBeTruthy();

    const row = (await balances.balancesForUser(A)).find((balance) => balance.userId === B);
    // Existence first: under "count only the due periods" this nets to zero
    // and HAVING drops the whole row — "not listed" must redden, not read as
    // some amount being wrong.
    expect(row).toBeDefined();
    expect(row?.balances).toHaveLength(1);
    expect(row?.balances[0]).toMatchObject({ currency: "TWD", amount: 6000 });
  });

  it("periods already past their date, with no recorded repayment, leave the balance whole (3.3)", async () => {
    // 360 monthly periods from 2026-06: from 2026-08 on at least two have
    // fallen due, and not all of them until 2056 — the window in which "a
    // period's date arriving reduces the balance" stays distinguishable from
    // the correct "only a recorded repayment does".
    await expect(
      expenses.create(
        createInput({ amount: 180000, day: "2026-06-15", shares: [scheduledShare(B, 180000, 360, 500)] }),
        installmentMirrors(B, CAT_B, E1, { periods: 360, amount: 500, startYear: 2026, startMonth: 6 }),
      ),
    ).resolves.toBeTruthy();

    const row = (await balances.balancesForUser(A)).find((balance) => balance.userId === B);
    expect(row).toBeDefined();
    expect(row?.balances).toHaveLength(1);
    // No split_settlement rows exist, so nothing has been repaid: scheduled
    // is not settled, whatever the calendar says.
    expect(row?.balances[0]).toMatchObject({ currency: "TWD", amount: 180000 });
  });
});

describe("schedule progress rides alongside the balance (4.3)", () => {
  it("only scheduled rows carry progress; unscheduled rows carry no field at all — not zeros", async () => {
    await expect(
      expenses.create(createInput({}), installmentMirrors(B, CAT_B, E1, { periods: 12, amount: 500, startYear: 2030 })),
    ).resolves.toBeTruthy();
    // C's debt has no schedule — today's ordinary lump path, valid as-is.
    await expenses.create(
      createInput({ id: E2, amount: 700, day: "2026-05-10", shares: [{ userId: C, amount: 700 }] }),
      [{ userId: C, splitExpenseId: E2, amount: 700, currency: "TWD", categoryId: CAT_C, day: "2026-05-10", note: "lunch" }],
    );

    const rows = await balances.balancesForUser(A);
    const rowB = rows.find((balance) => balance.userId === B);
    const rowC = rows.find((balance) => balance.userId === C);

    // The scheduled row says which period is next, of how many, and what that
    // period is worth — nothing due yet, so the next period is the first.
    expect(rowB?.balances[0]).toMatchObject({
      currency: "TWD",
      amount: 6000,
      schedule: { nextPeriod: 1, totalPeriods: 12, periodAmount: 500 },
    });
    // The unscheduled row must NOT carry the field — absent, not zeroed.
    // Zeros would make "no schedule" and "schedule finished" the same answer,
    // which is exactly what a client cannot tell apart.
    expect(rowC?.balances[0]).toMatchObject({ currency: "TWD", amount: 700 });
    expect(rowC?.balances[0]).not.toHaveProperty("schedule");
  });
});

describe("statement count is independent of the period count (5.4)", () => {
  it("creating a 360-period schedule writes the holder's mirrors with exactly ONE INSERT into finance_transaction", async () => {
    statements.length = 0;

    await expect(
      expenses.create(
        createInput({ amount: 180000, day: "2000-01-15", shares: [scheduledShare(B, 180000, 360, 500)] }),
        installmentMirrors(B, CAT_B, E1, { periods: 360, amount: 500, startYear: 2000 }),
      ),
    ).resolves.toBeTruthy();

    const mirrorRows = await harness.db.select().from(financeTransaction).where(eq(financeTransaction.userId, B));
    expect(mirrorRows).toHaveLength(360);
    // ONE multi-row INSERT (#82's shape) — one statement per period is what
    // this forbids, and 360 is what makes the fixture able to see it.
    expect(statements.filter((sql) => touchesTransactions(sql) && isInsert(sql))).toHaveLength(1);
  });


  it("editing a scheduled expense rewrites its periods instead of failing", async () => {
    // Reachable, not hypothetical: `schedule` is wired through
    // `PATCH /api/split/expenses/:id`, so a user can create a scheduled split
    // and then edit it. Before this was handled the edit raised a unique
    // violation on the period index — every scheduled expense was editable
    // exactly once, at creation, and any correction afterwards was a 500.
    await expenses.create(
      createInput({}),
      installmentMirrors(B, CAT_B, E1, { periods: 12, amount: 500, startYear: 2030 }),
    );

    await expect(
      expenses.update(
        E1,
        {
          payerUserId: A,
          amount: 7200,
          currency: "TWD",
          description: "annual fee",
          day: "2030-01-15",
          splitMode: "exact",
          categoryName: null,
          shares: [scheduledShare(B, 7200, 12, 600)],
        },
        installmentMirrors(B, CAT_B, E1, { periods: 12, amount: 600, startYear: 2030 }),
        new Date("2030-02-01T00:00:00Z"),
        A,
      ),
    ).resolves.toBeTruthy();

    const rows = await mirrorsOf(B, E1);
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.amount === 600)).toBe(true);
  });

  it("shortening a schedule drops the periods that no longer exist", async () => {
    // The half an upsert alone cannot do: rows 7..12 have nothing to conflict
    // with, so without an explicit delete they survive as orphans and the
    // holder's ledger keeps charging them for periods that were removed.
    await expenses.create(
      createInput({}),
      installmentMirrors(B, CAT_B, E1, { periods: 12, amount: 500, startYear: 2030 }),
    );

    await expenses.update(
      E1,
      {
        payerUserId: A,
        amount: 3000,
        currency: "TWD",
        description: "annual fee",
        day: "2030-01-15",
        splitMode: "exact",
        categoryName: null,
        shares: [scheduledShare(B, 3000, 6, 500)],
      },
      installmentMirrors(B, CAT_B, E1, { periods: 6, amount: 500, startYear: 2030 }),
      new Date("2030-02-01T00:00:00Z"),
      A,
    );

    const rows = await mirrorsOf(B, E1);
    expect(rows).toHaveLength(6);
  });
});
