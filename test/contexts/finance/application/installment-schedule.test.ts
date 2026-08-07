import { beforeEach, describe, expect, it } from "vitest";
import { createInstallmentPlan, type InstallmentDeps } from "../../../../src/contexts/finance/application/create-installment-plan";
import { InMemoryFinanceCategoryRepository, InMemoryFinanceTransactionRepository } from "../fakes";
import { InMemoryInstallmentPlanRepository } from "../installment-fakes";

/**
 * Instalment schedule generation (add-installments design.md D3/D4).
 *
 * FIXTURES ARE THE TEST here — both start on a month-end day, because a
 * fixture starting on the 15th passes under BOTH the anchored computation
 * (`start + N months`, decided) and the drifting one (previous + 1 month,
 * rejected). And the assertion that matters is the THIRD instalment: both
 * implementations put the second on 2/28, so a test that stops at the second
 * is blind to the drift (tasks.md 3.2).
 */

let categories: InMemoryFinanceCategoryRepository;
let transactions: InMemoryFinanceTransactionRepository;
let plans: InMemoryInstallmentPlanRepository;

beforeEach(() => {
  categories = new InMemoryFinanceCategoryRepository();
  transactions = new InMemoryFinanceTransactionRepository();
  plans = new InMemoryInstallmentPlanRepository(transactions);
});

function deps(nowIso: string): InstallmentDeps {
  return {
    planRepository: plans,
    categoryRepository: categories,
    now: () => new Date(nowIso),
    getUserTimezone: async () => "Asia/Taipei",
  };
}

async function seedExpenseCategory() {
  return categories.create({ userId: "user-1", name: "分期", type: "expense" });
}

function planRows() {
  return transactions.transactions
    .filter((t) => t.planId != null)
    .sort((a, b) => (a.installmentNo ?? 0) - (b.installmentNo ?? 0));
}

describe("createInstallmentPlan: month progression is anchored on the start day", () => {
  it("starting 1/31: February clamps to 2/28 but March is 3/31 again — the clamp is not carried forward", async () => {
    const category = await seedExpenseCategory();

    await createInstallmentPlan(deps("2026-01-31T02:00:00.000Z"), {
      userId: "user-1",
      mode: "per_installment",
      amount: 35000,
      periods: 3,
      currency: "TWD",
      categoryId: category.id,
      startDay: "2026-01-31",
    });

    const rows = planRows();
    expect(rows.map((r) => r.date)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    // The one assertion the drifting implementation fails: it yields 3/28
    // (1/31 → 2/28 → +1 month = 3/28) and never returns to the 31st.
    expect(rows[2]?.date).toBe("2026-03-31");
  });

  it("leap year: starting 2024-01-31, February lands on 2/29 and later months return to their own month-end/31st", async () => {
    const category = await seedExpenseCategory();

    await createInstallmentPlan(deps("2024-01-31T02:00:00.000Z"), {
      userId: "user-1",
      mode: "per_installment",
      amount: 1000,
      periods: 4,
      currency: "TWD",
      categoryId: category.id,
      startDay: "2024-01-31",
    });

    expect(planRows().map((r) => r.date)).toEqual(["2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30"]);
  });
});

describe("createInstallmentPlan: uneven totals (mode 'total')", () => {
  it("10000 over 3: earliest instalments carry the extra minor unit and the sum is exactly the total", async () => {
    const category = await seedExpenseCategory();

    // 10000 does NOT divide by 3 — a divisible fixture proves nothing here
    // (tasks.md 2.3): the invariant test would pass with the remainder
    // silently dropped.
    await createInstallmentPlan(deps("2026-01-10T02:00:00.000Z"), {
      userId: "user-1",
      mode: "total",
      amount: 10000,
      periods: 3,
      currency: "TWD",
      categoryId: category.id,
      startDay: "2026-01-10",
    });

    const rows = planRows();
    expect(rows.map((r) => r.amount)).toEqual([3334, 3333, 3333]);
    expect(rows.reduce((sum, r) => sum + r.amount, 0)).toBe(10000);
  });
});
