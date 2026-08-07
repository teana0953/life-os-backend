import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { DrizzleInstallmentPlanRepository } from "../../src/contexts/finance/adapters/drizzle-installment-plan-repository";
import type { CreateInstallmentPlanRecord, InstallmentRow } from "../../src/contexts/finance/domain/installment-plan";
import { financeTransaction } from "../../src/shared/db/schema";
import { createTestDb, insertCategory, insertUser, type TestDb } from "./harness";

/**
 * The instalment write paths against a real Postgres (add-installments
 * design.md D3b/D6, tasks 0.4/5.4/8.2).
 *
 * WHY 360: the mortgage case. neon-http's `db.batch` statement limit is
 * UNKNOWABLE (driver docs, source and Neon's docs are all silent), and the
 * PGlite harness explicitly cannot prove it either way — so the only safe
 * property is that the statement count does not grow with the instalment
 * count: creation is ONE multi-row INSERT, clearing is ONE
 * `DELETE WHERE user_id = ? AND plan_id = ? AND day > ?`. A 3-instalment
 * fixture passes under one-statement-per-instalment too; 360 makes the
 * counting assertion mean something, and the count is asserted directly.
 *
 * Atomicity uses an invalid calendar date (`2026-02-30`) as the injectable
 * failure: Postgres rejects that one statement at execution, independent of
 * whatever schema/constraint decisions the implementation makes, so it can
 * only pass if the DELETE and the INSERT genuinely share one transaction.
 */

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const CAT_A = "ca000001-0000-0000-0000-000000000000";
const CAT_B = "cb000001-0000-0000-0000-000000000000";

let testDb: TestDb;
let repo: DrizzleInstallmentPlanRepository;
const statements: string[] = [];

beforeAll(async () => {
  testDb = await createTestDb({ onQuery: (sql) => statements.push(sql) });
  repo = new DrizzleInstallmentPlanRepository(testDb.db);
});

afterAll(async () => {
  await testDb.close();
});

beforeEach(async () => {
  await testDb.resetDb();
  await insertUser(testDb.db, A, "a@example.com");
  await insertUser(testDb.db, B, "b@example.com");
  await insertCategory(testDb.db, { id: CAT_A, userId: A, name: "分期" });
  await insertCategory(testDb.db, { id: CAT_B, userId: B, name: "分期" });
  statements.length = 0;
});

/** First-of-month instalments starting January `startYear` — 360 of them spans 30 years. */
function monthlyRows(count: number, startYear: number, amount: number): InstallmentRow[] {
  return Array.from({ length: count }, (_, i) => ({
    installmentNo: i + 1,
    day: `${startYear + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`,
    amount,
  }));
}

function mortgagePlan(periods: number, startDay: string): CreateInstallmentPlanRecord {
  return { userId: A, mode: "per_installment", periods, startDay, amount: 35000, currency: "TWD", categoryId: CAT_A, note: "房貸" };
}

const touchesTransactions = (sql: string) => sql.includes('"finance_transaction"');
const isInsert = (sql: string) => /insert\s+into/i.test(sql);
const isDelete = (sql: string) => /delete\s+from/i.test(sql);

async function rowsFor(userId: string) {
  return testDb.db.select().from(financeTransaction).where(eq(financeTransaction.userId, userId));
}

describe("statement count is independent of the number of instalments (D3b)", () => {
  it("creating a 360-instalment mortgage writes all 360 rows with exactly ONE INSERT into finance_transaction", async () => {
    await repo.createWithInstallments(mortgagePlan(360, "2000-01-01"), monthlyRows(360, 2000, 35000));

    const rows = await rowsFor(A);
    expect(rows).toHaveLength(360);
    expect(statements.filter((s) => touchesTransactions(s) && isInsert(s))).toHaveLength(1);
  });

  it("settling early clears the 174 upcoming instalments with exactly ONE DELETE from finance_transaction", async () => {
    const plan = await repo.createWithInstallments(mortgagePlan(360, "2000-01-01"), monthlyRows(360, 2000, 35000));
    statements.length = 0;

    // User's today 2015-06-15: 186 instalments (2000-01 .. 2015-06) have
    // fallen due, 174 are still to come. Payoff figure copied from the bank.
    await repo.settle(A, plan.id, "2015-06-15", { day: "2015-06-15", amount: 5000000, currency: "TWD", categoryId: CAT_A });

    const rows = await rowsFor(A);
    expect(rows).toHaveLength(187); // 186 due + 1 settlement
    expect(rows.filter((r) => r.day > "2015-06-15")).toEqual([]);
    expect(statements.filter((s) => touchesTransactions(s) && isDelete(s))).toHaveLength(1);
  });

  it("rewriting the upcoming instalments is ONE DELETE plus ONE multi-row INSERT, whatever the count", async () => {
    const all = monthlyRows(360, 2000, 35000);
    const plan = await repo.createWithInstallments(mortgagePlan(360, "2000-01-01"), all);
    statements.length = 0;

    // Bank recalculated after a rate change: the 174 upcoming become 36 000.
    const rewritten = all.slice(186).map((row) => ({ ...row, amount: 36000 }));
    await repo.rewriteUpcoming(A, plan.id, "2015-06-15", rewritten);

    const rows = await rowsFor(A);
    expect(rows).toHaveLength(360);
    expect(rows.filter((r) => r.amount === 36000)).toHaveLength(174);
    expect(rows.filter((r) => r.day <= "2015-06-15" && r.amount === 35000)).toHaveLength(186);
    expect(statements.filter((s) => touchesTransactions(s) && isDelete(s))).toHaveLength(1);
    expect(statements.filter((s) => touchesTransactions(s) && isInsert(s))).toHaveLength(1);
  });
});

describe("the delete-and-insert pair lives or dies as one batch (D6, tasks 5.4)", () => {
  it("a failing settlement INSERT rolls the DELETE back — the upcoming instalments survive", async () => {
    const plan = await repo.createWithInstallments(mortgagePlan(3, "2026-01-01"), monthlyRows(3, 2026, 35000));
    expect(await rowsFor(A)).toHaveLength(3);

    // 2026-02-30 does not exist; Postgres rejects the settlement INSERT.
    await expect(repo.settle(A, plan.id, "2026-01-15", { day: "2026-02-30", amount: 70000, currency: "TWD", categoryId: CAT_A })).rejects.toThrow();

    const rows = await rowsFor(A);
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.day > "2026-01-15").map((r) => r.day).sort()).toEqual(["2026-02-01", "2026-03-01"]);
  });

  it("a failing rewrite INSERT rolls the DELETE back — the old upcoming instalments survive", async () => {
    const plan = await repo.createWithInstallments(mortgagePlan(3, "2026-01-01"), monthlyRows(3, 2026, 35000));
    expect(await rowsFor(A)).toHaveLength(3);

    await expect(
      repo.rewriteUpcoming(A, plan.id, "2026-01-15", [
        { installmentNo: 2, day: "2026-02-28", amount: 40000 },
        { installmentNo: 3, day: "2026-02-30", amount: 40000 }, // invalid — fails the INSERT
      ]),
    ).rejects.toThrow();

    const rows = await rowsFor(A);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.amount === 35000)).toBe(true);
  });
});

describe("the clearing DELETE is scoped by user_id, not just plan_id (tasks 0.4)", () => {
  it("another user settling with a stolen plan id cannot delete the owner's instalments", async () => {
    const plan = await repo.createWithInstallments(mortgagePlan(3, "2026-01-01"), monthlyRows(3, 2026, 35000));
    expect(await rowsFor(A)).toHaveLength(3);

    await repo
      .settle(B, plan.id, "2026-01-15", { day: "2026-06-15", amount: 1000, currency: "TWD", categoryId: CAT_B })
      .catch(() => undefined); // whether B's call errors is not the point — A's rows are

    const rows = await rowsFor(A);
    expect(rows.map((r) => r.day).sort()).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    expect(rows.every((r) => r.amount === 35000)).toBe(true);
  });
});
