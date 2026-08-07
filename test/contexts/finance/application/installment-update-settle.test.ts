import { beforeEach, describe, expect, it } from "vitest";
import { createInstallmentPlan, type InstallmentDeps } from "../../../../src/contexts/finance/application/create-installment-plan";
import { settleInstallmentPlan } from "../../../../src/contexts/finance/application/settle-installment-plan";
import { updateInstallmentPlan } from "../../../../src/contexts/finance/application/update-installment-plan";
import { InMemoryFinanceCategoryRepository, InMemoryFinanceTransactionRepository } from "../fakes";
import { InMemoryInstallmentPlanRepository } from "../installment-fakes";

/**
 * Changing and settling a plan (add-installments design.md D2b/D5/D6/D6c).
 *
 * "Today" is the USER's today (`users.timezone`), and today's instalment has
 * already fallen due (strict `day > today`). The timezone cases pin the ONE
 * instant where UTC and Asia/Taipei disagree about the date —
 * `2026-03-31T20:00Z` = `2026-04-01 04:00` in Taipei. At any other hour both
 * implementations answer alike and the fixture proves nothing.
 */

const USER = "user-1";

let categories: InMemoryFinanceCategoryRepository;
let transactions: InMemoryFinanceTransactionRepository;
let plans: InMemoryInstallmentPlanRepository;
let nowIso: string;

beforeEach(() => {
  categories = new InMemoryFinanceCategoryRepository();
  transactions = new InMemoryFinanceTransactionRepository();
  plans = new InMemoryInstallmentPlanRepository(transactions);
  nowIso = "2026-04-20T02:00:00.000Z"; // 10:00 Asia/Taipei — same date in both zones
});

function deps(): InstallmentDeps {
  return {
    planRepository: plans,
    categoryRepository: categories,
    now: () => new Date(nowIso),
    getUserTimezone: async () => "Asia/Taipei",
  };
}

async function seedExpenseCategory(name = "分期") {
  return categories.create({ userId: USER, name, type: "expense" });
}

function rowsOf(planId: string) {
  return transactions.transactions.filter((t) => t.planId === planId).sort((a, b) => a.date.localeCompare(b.date));
}

describe("updateInstallmentPlan rewrites only the instalments still to come", () => {
  it("total mode: fallen-due instalments keep amount and date; the remaining total is spread over the periods still to come", async () => {
    const category = await seedExpenseCategory();
    // 12 000 over 12 from 2026-01-15 → 1 000 on the 15th of every month.
    const plan = await createInstallmentPlan(deps(), {
      userId: USER,
      mode: "total",
      amount: 12000,
      periods: 12,
      currency: "TWD",
      categoryId: category.id,
      startDay: "2026-01-15",
    });

    expect(rowsOf(plan.id)).toHaveLength(12);

    // Today 2026-04-20: instalments 1..4 (01-15 .. 04-15) have fallen due.
    // New total 24 000 − 4 000 already due = 20 000 over the 8 to come.
    await updateInstallmentPlan(deps(), { userId: USER, planId: plan.id, amount: 24000, periods: 12 });

    const rows = rowsOf(plan.id);
    expect(rows).toHaveLength(12);
    expect(rows.slice(0, 4).map((r) => ({ date: r.date, amount: r.amount }))).toEqual([
      { date: "2026-01-15", amount: 1000 },
      { date: "2026-02-15", amount: 1000 },
      { date: "2026-03-15", amount: 1000 },
      { date: "2026-04-15", amount: 1000 },
    ]);
    expect(rows.slice(4).map((r) => r.amount)).toEqual([2500, 2500, 2500, 2500, 2500, 2500, 2500, 2500]);
    // Rewritten instalments stay anchored on the original day-of-month.
    expect(rows.slice(4).map((r) => r.date)).toEqual([
      "2026-05-15",
      "2026-06-15",
      "2026-07-15",
      "2026-08-15",
      "2026-09-15",
      "2026-10-15",
      "2026-11-15",
      "2026-12-15",
    ]);
  });

  it("uses the user's timezone for 'today': at 2026-03-31T20:00Z a Taipei user's 04-01 instalment has fallen due and is NOT rewritten", async () => {
    const category = await seedExpenseCategory();
    const plan = await createInstallmentPlan(deps(), {
      userId: USER,
      mode: "per_installment",
      amount: 35000,
      periods: 3,
      currency: "TWD",
      categoryId: category.id,
      startDay: "2026-03-01",
    });
    expect(rowsOf(plan.id)).toHaveLength(3); // 03-01, 04-01, 05-01

    nowIso = "2026-03-31T20:00:00.000Z"; // Taipei: 2026-04-01 04:00 — UTC still 03-31
    await updateInstallmentPlan(deps(), { userId: USER, planId: plan.id, amount: 30000, periods: 3 });

    const byDate = new Map(rowsOf(plan.id).map((r) => [r.date, r.amount]));
    // User's today is 04-01, and today's instalment counts as fallen due
    // (strict >): a UTC implementation thinks today is 03-31 and rewrites it.
    expect(byDate.get("2026-04-01")).toBe(35000);
    expect(byDate.get("2026-05-01")).toBe(30000);
  });
});

describe("settleInstallmentPlan replaces the instalments still to come with one transaction dated the user's today", () => {
  it("total mode: upcoming instalments are gone; today's single transaction carries their sum", async () => {
    const category = await seedExpenseCategory();
    const plan = await createInstallmentPlan(deps(), {
      userId: USER,
      mode: "total",
      amount: 12000,
      periods: 12,
      currency: "TWD",
      categoryId: category.id,
      startDay: "2026-01-15",
    });
    expect(rowsOf(plan.id)).toHaveLength(12);

    await settleInstallmentPlan(deps(), { userId: USER, planId: plan.id });

    const rows = rowsOf(plan.id);
    // 4 fallen due + the settlement; nothing dated after today survives.
    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => r.date > "2026-04-20")).toEqual([]);
    const settlement = rows.find((r) => r.date === "2026-04-20");
    expect(settlement).toMatchObject({ amount: 8000, planId: plan.id, type: "expense" });
  });

  it("computes the settlement from the rows that EXIST: a deleted upcoming instalment is not settled for (D2b)", async () => {
    const category = await seedExpenseCategory();
    const plan = await createInstallmentPlan(deps(), {
      userId: USER,
      mode: "total",
      amount: 12000,
      periods: 12,
      currency: "TWD",
      categoryId: category.id,
      startDay: "2026-01-15",
    });
    expect(rowsOf(plan.id)).toHaveLength(12);

    // The user deletes September's instalment — "that one will not happen".
    const september = rowsOf(plan.id).find((r) => r.date === "2026-09-15");
    expect(september).toBeDefined();
    await transactions.delete(USER, september!.id);

    await settleInstallmentPlan(deps(), { userId: USER, planId: plan.id });

    // 7 upcoming rows remained (8 minus the deleted one): 7 000, not the
    // plan-derived 8 000 — plan totals never enter any computation.
    const settlement = rowsOf(plan.id).find((r) => r.date === "2026-04-20");
    expect(settlement?.amount).toBe(7000);
  });

  it("per-instalment mode: the settlement amount is the one the user copied from the bank, never the sum of the remaining instalments", async () => {
    const category = await seedExpenseCategory();
    // 24-month contract at 35 000 from 2025-01-10; today 2026-06-15 → 18 due, 6 to come (sum 210 000).
    nowIso = "2026-06-15T02:00:00.000Z";
    const plan = await createInstallmentPlan(deps(), {
      userId: USER,
      mode: "per_installment",
      amount: 35000,
      periods: 24,
      currency: "TWD",
      categoryId: category.id,
      startDay: "2025-01-10",
    });
    expect(rowsOf(plan.id)).toHaveLength(24);

    // The bank's payoff figure — remaining principal + penalty, NOT 210 000
    // (that sum contains future interest settling avoids, D0/D6).
    await settleInstallmentPlan(deps(), { userId: USER, planId: plan.id, amount: 180000 });

    const settlement = rowsOf(plan.id).find((r) => r.date === "2026-06-15");
    expect(settlement?.amount).toBe(180000);
    expect(rowsOf(plan.id).some((r) => r.amount === 210000)).toBe(false);
  });

  it("dates the settlement on the user's today, not UTC's: at 2026-03-31T20:00Z a Taipei settlement lands on 04-01 and keeps 04-01's instalment", async () => {
    const category = await seedExpenseCategory();
    const plan = await createInstallmentPlan(deps(), {
      userId: USER,
      mode: "per_installment",
      amount: 35000,
      periods: 3,
      currency: "TWD",
      categoryId: category.id,
      startDay: "2026-03-01",
    });
    expect(rowsOf(plan.id)).toHaveLength(3); // 03-01, 04-01, 05-01

    nowIso = "2026-03-31T20:00:00.000Z"; // Taipei 2026-04-01 04:00
    await settleInstallmentPlan(deps(), { userId: USER, planId: plan.id, amount: 30000 });

    const rows = rowsOf(plan.id);
    // Only 05-01 was still to come. 04-01 is the user's today → fallen due → stays.
    expect(rows.map((r) => ({ date: r.date, amount: r.amount }))).toEqual([
      { date: "2026-03-01", amount: 35000 },
      { date: "2026-04-01", amount: 35000 },
      { date: "2026-04-01", amount: 30000 },
    ]);
  });
});

describe("edge cases: exhausted or emptied plans, and expense-only", () => {
  it("settling a plan whose every instalment has fallen due is rejected — never a zero or dangling settlement", async () => {
    const category = await seedExpenseCategory();
    nowIso = "2026-06-15T02:00:00.000Z";
    const plan = await createInstallmentPlan(deps(), {
      userId: USER,
      mode: "per_installment",
      amount: 35000,
      periods: 3,
      currency: "TWD",
      categoryId: category.id,
      startDay: "2025-01-10", // all three fell due long ago
    });

    await expect(settleInstallmentPlan(deps(), { userId: USER, planId: plan.id, amount: 999 })).rejects.toThrow();

    const rows = rowsOf(plan.id);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.amount === 35000)).toBe(true);
  });

  it("changing a plan so that zero periods remain is rejected, leaving every row untouched", async () => {
    const category = await seedExpenseCategory();
    nowIso = "2026-06-15T02:00:00.000Z";
    const plan = await createInstallmentPlan(deps(), {
      userId: USER,
      mode: "per_installment",
      amount: 35000,
      periods: 3,
      currency: "TWD",
      categoryId: category.id,
      startDay: "2025-01-10",
    });

    await expect(updateInstallmentPlan(deps(), { userId: USER, planId: plan.id, amount: 40000, periods: 3 })).rejects.toThrow();

    const rows = rowsOf(plan.id);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.amount === 35000)).toBe(true);
  });

  it("settling a plan whose instalments were all individually deleted is rejected and inserts nothing", async () => {
    const category = await seedExpenseCategory();
    nowIso = "2026-06-15T02:00:00.000Z";
    const plan = await createInstallmentPlan(deps(), {
      userId: USER,
      mode: "total",
      amount: 9000,
      periods: 3,
      currency: "TWD",
      categoryId: category.id,
      startDay: "2026-06-10",
    });
    expect(rowsOf(plan.id)).toHaveLength(3);
    for (const row of rowsOf(plan.id)) await transactions.delete(USER, row.id);

    await expect(settleInstallmentPlan(deps(), { userId: USER, planId: plan.id })).rejects.toThrow();

    expect(rowsOf(plan.id)).toEqual([]);
    expect(transactions.transactions.some((t) => t.amount <= 0)).toBe(false);
  });

  it("instalments are expense-only: an income category is rejected and nothing is written (D7)", async () => {
    const income = await categories.create({ userId: USER, name: "獎金", type: "income" });

    await expect(
      createInstallmentPlan(deps(), {
        userId: USER,
        mode: "total",
        amount: 12000,
        periods: 12,
        currency: "TWD",
        categoryId: income.id,
        startDay: "2026-04-15",
      }),
    ).rejects.toThrow();

    expect(transactions.transactions).toEqual([]);
    expect(plans.plans).toEqual([]);
  });
});
