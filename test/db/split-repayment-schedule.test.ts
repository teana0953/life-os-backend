import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
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
const D = "44444444-4444-4444-4444-444444444444"; // holder on a different schedule
const E1 = "e1111111-1111-1111-1111-111111111111";
const E2 = "e2222222-2222-2222-2222-222222222222";
const CAT_B = "cb000001-0000-0000-0000-000000000000";
const CAT_C = "cc000001-0000-0000-0000-000000000000";
const CAT_D = "cd000001-0000-0000-0000-000000000000";

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

/// The single mirror row an unscheduled share produces.
function lumpMirror(userId: string, categoryId: string, splitExpenseId: string, amount: number): ShareMirrorRow {
  return {
    userId,
    splitExpenseId,
    amount,
    currency: "TWD",
    categoryId,
    day: "2030-01-15",
    note: "annual fee",
  } as ShareMirrorRow;
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
  await insertUser(harness.db, D, "d@example.com", "Dan");
  await insertCategory(harness.db, { id: CAT_B, userId: B, name: "其他" });
  await insertCategory(harness.db, { id: CAT_C, userId: C, name: "其他" });
  await insertCategory(harness.db, { id: CAT_D, userId: D, name: "其他" });
  statements.length = 0;
});

describe("the balance ignores the schedule (3.2, 3.3)", () => {
  it("a freshly scheduled debt with no period due yet is owed in full — and the row exists (3.2)", async () => {
    // Every period is in 2030: nothing is due at any realistic run date.
    await expect(
      expenses.create(createInput({}), installmentMirrors(B, CAT_B, E1, { periods: 12, amount: 500, startYear: 2030 })),
    ).resolves.toBeTruthy();

    const row = (await balances.balancesForUser(A, "2029-12-31")).find((balance) => balance.userId === B);
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

    const row = (await balances.balancesForUser(A, "2029-12-31")).find((balance) => balance.userId === B);
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

    const rows = await balances.balancesForUser(A, "2029-12-31");
    const rowB = rows.find((balance) => balance.userId === B);
    const rowC = rows.find((balance) => balance.userId === C);

    // The scheduled row says which period is next, of how many, and what that
    // period is worth — nothing due yet, so the next period is the first.
    expect(rowB?.balances[0]).toMatchObject({
      currency: "TWD",
      amount: 6000,
      // `nextPeriod` 1, because "today" is before the first period's date.
      // The date is a parameter now, not `CURRENT_DATE` — which is what makes
      // this assertion mean anything: with the date decided inside SQL, the
      // expected value would drift with the wall clock.
      schedules: [{ expenseId: E1, nextPeriod: 1, totalPeriods: 12, periodAmount: 500 }],
    });
    // The unscheduled row must NOT carry the field — absent, not zeroed.
    // Zeros would make "no schedule" and "schedule finished" the same answer,
    // which is exactly what a client cannot tell apart.
    expect(rowC?.balances[0]).toMatchObject({ currency: "TWD", amount: 700 });
    expect(rowC?.balances[0]).not.toHaveProperty("schedules");
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

  it("dropping a schedule removes the periods it used to have", async () => {
    // The mirror rewrite has to be a **replace**, and switching kind is the
    // case neither existing delete covered: `mirrorDelete` only removes
    // holders who left the expense, and the dropped-period delete only
    // removes periods above the holder's own new highest — a holder who is
    // still here and now unscheduled matches neither. What survived was all
    // twelve periods plus a fresh lump row: 13 rows charging 12,000 for a
    // 6,000 share, reachable by editing any scheduled split without
    // re-sending its schedule.
    await expenses.create(
      createInput({}),
      installmentMirrors(B, CAT_B, E1, { periods: 12, amount: 500, startYear: 2030 }),
    );

    await expenses.update(
      E1,
      {
        payerUserId: A,
        amount: 6000,
        currency: "TWD",
        description: "annual fee",
        day: "2030-01-15",
        splitMode: "exact",
        categoryName: null,
        shares: [{ userId: B, amount: 6000 }],
      },
      [lumpMirror(B, CAT_B, E1, 6000)],
      new Date("2030-02-01T00:00:00Z"),
      A,
    );

    const rows = await mirrorsOf(B, E1);
    expect(rows).toEqual([expect.objectContaining({ amount: 6000, installmentNo: null })]);
  });

  it("adding a schedule removes the lump row it replaces", async () => {
    // The same hole from the other side: the lump row has no period to
    // conflict with, so the period upsert cannot reach it, and it was left
    // alongside the twelve new periods — again 13 rows, again 12,000.
    await expenses.create(
      createInput({ shares: [{ userId: B, amount: 6000 }] }),
      [lumpMirror(B, CAT_B, E1, 6000)],
    );

    await expenses.update(
      E1,
      {
        payerUserId: A,
        amount: 6000,
        currency: "TWD",
        description: "annual fee",
        day: "2030-01-15",
        splitMode: "exact",
        categoryName: null,
        shares: [scheduledShare(B, 6000, 12, 500)],
      },
      installmentMirrors(B, CAT_B, E1, { periods: 12, amount: 500, startYear: 2030 }),
      new Date("2030-02-01T00:00:00Z"),
      A,
    );

    const rows = await mirrorsOf(B, E1);
    expect(rows).toHaveLength(12);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(6000);
    expect(rows.every((row) => row.installmentNo != null)).toBe(true);
  });

  it("switching one holder's kind leaves the other holder's mirrors alone", async () => {
    // The delete is per holder, and the fix widens which holders get one —
    // widening it into a per-expense delete would take D's periods with it.
    await expenses.create(
      createInput({
        amount: 9000,
        shares: [scheduledShare(B, 6000, 12, 500), scheduledShare(D, 3000, 6, 500)],
      }),
      [
        ...installmentMirrors(B, CAT_B, E1, { periods: 12, amount: 500, startYear: 2030 }),
        ...installmentMirrors(D, CAT_D, E1, { periods: 6, amount: 500, startYear: 2030 }),
      ],
    );

    await expenses.update(
      E1,
      {
        payerUserId: A,
        amount: 9000,
        currency: "TWD",
        description: "annual fee",
        day: "2030-01-15",
        splitMode: "exact",
        categoryName: null,
        shares: [{ userId: B, amount: 6000 }, scheduledShare(D, 3000, 6, 500)],
      },
      [
        lumpMirror(B, CAT_B, E1, 6000),
        ...installmentMirrors(D, CAT_D, E1, { periods: 6, amount: 500, startYear: 2030 }),
      ],
      new Date("2030-02-01T00:00:00Z"),
      A,
    );

    expect(await mirrorsOf(B, E1)).toHaveLength(1);
    expect(await mirrorsOf(D, E1)).toHaveLength(6);
  });

  it("reads a share's schedule back, so an edit can re-send it", async () => {
    // Without this the read shape has no schedule in it, and every client
    // editing a scheduled split necessarily drops the schedule — it cannot
    // send back what it was never told. `split_share` has no schedule
    // columns; the mirror rows are the schedule, so the read derives it from
    // them rather than keeping a second copy that can disagree.
    await expenses.create(
      createInput({ shares: [scheduledShare(B, 6000, 12, 500), { userId: C, amount: 700 }], amount: 6700 }),
      [
        ...installmentMirrors(B, CAT_B, E1, { periods: 12, amount: 500, startYear: 2030 }),
        { userId: C, splitExpenseId: E1, amount: 700, currency: "TWD", categoryId: CAT_C, day: "2030-01-15", note: "annual fee" } as ShareMirrorRow,
      ],
    );

    for (const expense of [await expenses.findById(E1), (await expenses.listForUser(A, {}))[0]]) {
      expect(expense?.shares.find((share) => share.userId === B)?.schedule).toEqual({ periods: 12, perPeriodAmount: 500 });
      // Absent, not zeroed — same reason as the balance's progress field.
      expect(expense?.shares.find((share) => share.userId === C)).not.toHaveProperty("schedule");
    }
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

  it("when multiple holders have different schedules, shortening one does not orphan the other's periods", async () => {
    // The critical case: holder B on 12 periods, holder D on 6 periods, same
    // expense. The old code computed highestPeriod as a global max across all
    // holders (12), so when shortening D from 6 to 3 periods, it would compare
    // D's periods 4-6 against the global max of 12 and leave them as orphans.
    // The fix tracks the max per holder, so D's periods 4-6 are correctly
    // deleted while B's 12 survive.
    const amount12b = 6000;
    const amount6d = 3000;
    await expenses.create(
      createInput({
        amount: amount12b + amount6d,
        day: "2030-01-15",
        shares: [scheduledShare(B, amount12b, 12, 500), scheduledShare(D, amount6d, 6, 500)],
      }),
      [...installmentMirrors(B, CAT_B, E1, { periods: 12, amount: 500, startYear: 2030 }), ...installmentMirrors(D, CAT_D, E1, { periods: 6, amount: 500, startYear: 2030 })],
    );

    // Verify setup: B has 12 periods, D has 6
    let bRows = await mirrorsOf(B, E1);
    let dRows = await mirrorsOf(D, E1);
    expect(bRows).toHaveLength(12);
    expect(dRows).toHaveLength(6);

    // Now shorten D's schedule from 6 to 3 periods
    await expenses.update(
      E1,
      {
        payerUserId: A,
        amount: amount12b + 1500,
        currency: "TWD",
        description: "annual fee",
        day: "2030-01-15",
        splitMode: "exact",
        categoryName: null,
        shares: [scheduledShare(B, amount12b, 12, 500), scheduledShare(D, 1500, 3, 500)],
      },
      [...installmentMirrors(B, CAT_B, E1, { periods: 12, amount: 500, startYear: 2030 }), ...installmentMirrors(D, CAT_D, E1, { periods: 3, amount: 500, startYear: 2030 })],
      new Date("2030-02-01T00:00:00Z"),
      A,
    );

    // After the edit: B's 12 periods survive, D's orphaned 4-6 are deleted
    bRows = await mirrorsOf(B, E1);
    dRows = await mirrorsOf(D, E1);
    expect(bRows).toHaveLength(12);
    expect(dRows).toHaveLength(3);
    // Verify the periods are the right ones (1-3, not 4-6)
    expect(dRows.every((r) => r.installmentNo && r.installmentNo <= 3)).toBe(true);
  });


  it("due periods follow the date it is where the caller is", async () => {
    // The whole reason the date is a parameter. A period dated 2030-01-15 is
    // due for a caller whose local date is the 15th and not due for one whose
    // local date is still the 14th — the eight hours a Taipei user is a day
    // ahead of UTC. With the date decided inside SQL there was no way to
    // express either side of that boundary, and the spelling that looked like
    // a fix (`CURRENT_DATE AT TIME ZONE tz`) returned a timestamp that
    // compared against a `date` by implicit cast: no error, wrong answer.
    await expenses.create(
      createInput({}),
      installmentMirrors(B, CAT_B, E1, { periods: 12, amount: 500, startYear: 2030 }),
    );

    const dayBefore = await balances.balancesForUser(A, "2030-01-14");
    const dayOf = await balances.balancesForUser(A, "2030-01-15");

    expect(dayBefore[0]?.balances[0]?.schedules?.[0]?.nextPeriod).toBe(1);
    expect(dayOf[0]?.balances[0]?.schedules?.[0]?.nextPeriod).toBe(2);
  });


  it("two schedules with the same counterpart and currency stay two schedules", async () => {
    // Nothing stops a user from splitting two things with the same friend,
    // both scheduled, both TWD — and grouping progress by (counterpart,
    // currency) alone produced a single row belonging to neither: the period
    // counts summed (12 + 6 = 18) while the amount came from whichever
    // schedule happened to be larger (MAX(500, 900) = 900), so the client was
    // told "period 1 of 18, worth 900" for a pair of schedules that are
    // 12x500 and 6x900.
    await expenses.create(
      createInput({}),
      installmentMirrors(B, CAT_B, E1, { periods: 12, amount: 500, startYear: 2030 }),
    );
    await expenses.create(
      createInput({ id: E2, amount: 5400, description: "flights", shares: [scheduledShare(B, 5400, 6, 900)] }),
      installmentMirrors(B, CAT_B, E2, { periods: 6, amount: 900, startYear: 2030 }),
    );

    const rows = await balances.balancesForUser(A, "2029-12-31");
    const schedules = rows.find((balance) => balance.userId === B)?.balances[0]?.schedules ?? [];

    expect(schedules).toHaveLength(2);
    expect([...schedules].sort((x, y) => y.totalPeriods - x.totalPeriods)).toEqual([
      { expenseId: E1, nextPeriod: 1, totalPeriods: 12, periodAmount: 500 },
      { expenseId: E2, nextPeriod: 1, totalPeriods: 6, periodAmount: 900 },
    ]);
  });


  it("the database refuses a row that is both a plan period and a split mirror", async () => {
    // `installment_no` carries two meanings — a bank instalment's position
    // when `plan_id` is set, a repayment period's when `split_expense_id` is —
    // and the whole arrangement is only safe because a row can never be both.
    // That was true by convention until this constraint; the two partial
    // unique indexes are keyed off `installment_no`'s nullness, so a row with
    // both origins would be arbitrated by the wrong one.
    await expenses.create(
      createInput({}),
      installmentMirrors(B, CAT_B, E1, { periods: 1, amount: 6000, startYear: 2030 }),
    );

    // A real plan row first, so the failure is the constraint and not the
    // foreign key — otherwise this passes for the wrong reason.
    const planId = "f1111111-1111-1111-1111-111111111111";
    await harness.db.execute(sql`
      INSERT INTO finance_installment_plan (id, user_id, mode, amount, periods, currency, category_id, start_day)
      VALUES (${planId}::uuid, ${B}::uuid, 'total', 6000, 12, 'TWD', ${CAT_B}::uuid, '2030-01-15')
    `);

    await expect(
      harness.db.execute(sql`
        UPDATE finance_transaction
           SET plan_id = ${planId}::uuid
         WHERE split_expense_id = ${E1}::uuid
      `),
    ).rejects.toThrow();
  });
});
