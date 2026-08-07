import { beforeEach, describe, expect, it } from "vitest";
import { createInstallmentPlan, type InstallmentDeps } from "../../../../src/contexts/finance/application/create-installment-plan";
import { createTransaction } from "../../../../src/contexts/finance/application/create-transaction";
import { updateTransaction } from "../../../../src/contexts/finance/application/update-transaction";
import {
  FakeBudgetAlertNotifier,
  InMemoryFinanceBudgetRepository,
  InMemoryFinanceCategoryRepository,
  InMemoryFinanceTransactionRepository,
} from "../fakes";
import { InMemoryInstallmentPlanRepository } from "../installment-fakes";

/**
 * Budget alerts vs instalments (add-installments design.md D4b): alerts fire
 * only for instalment months ≤ the USER's today. `finance_budget_alert` is
 * unique on (budget, month, threshold), so a future-month write that fires
 * today BURNS that month's alert row — when the month really arrives and the
 * user really overspends, the alert never rings. Silently, permanently.
 *
 * THE FIXTURE IS THE TEST (tasks.md 0b.1d): the threshold decision sits in
 * `checkBudget` on the MONTH'S CUMULATIVE spend, so every per-instalment
 * amount here (35 000 against a 40 000 budget → 87.5% ≥ 80%) crosses a
 * threshold BY ITSELF. With a small instalment (1 000/month) nothing fires
 * either way and both implementations stay green — an empty guard.
 *
 * The rule has two halves and the rejected alternative ("anything carrying a
 * plan_id never triggers") passes every test that only checks the
 * suppression half (tasks.md 0b.1e) — so the trigger half is pinned too, on
 * both doors (`createTransaction`-equivalent plan creation AND
 * `updateTransaction`).
 */

const USER = "user-1";
const BUDGET_AMOUNT = 40000; // overall monthly budget; one 35 000 instalment alone crosses 80%
const PER_INSTALLMENT = 35000;

let categories: InMemoryFinanceCategoryRepository;
let transactions: InMemoryFinanceTransactionRepository;
let plans: InMemoryInstallmentPlanRepository;
let budgets: InMemoryFinanceBudgetRepository;
let notifier: FakeBudgetAlertNotifier;
let nowIso: string;

beforeEach(() => {
  categories = new InMemoryFinanceCategoryRepository();
  transactions = new InMemoryFinanceTransactionRepository();
  plans = new InMemoryInstallmentPlanRepository(transactions);
  budgets = new InMemoryFinanceBudgetRepository(transactions);
  notifier = new FakeBudgetAlertNotifier();
  nowIso = "2026-04-10T02:00:00.000Z"; // 10:00 Asia/Taipei, 2026-04-10 in both zones
});

const now = () => new Date(nowIso);
const getUserTimezone = async () => "Asia/Taipei";

function installmentDeps(): InstallmentDeps {
  return { planRepository: plans, categoryRepository: categories, now, getUserTimezone };
}

function budgetAlertDeps() {
  return { budgetRepository: budgets, categoryRepository: categories, notifier, now, getUserTimezone };
}

async function seedCategoryAndOverallBudget() {
  const category = await categories.create({ userId: USER, name: "分期", type: "expense" });
  await budgets.upsert({ userId: USER, categoryId: null, amount: BUDGET_AMOUNT });
  return category;
}

function planRows() {
  return transactions.transactions.filter((t) => t.planId != null).sort((a, b) => a.date.localeCompare(b.date));
}

describe("creating a plan spanning future months (suppression half + current-month trigger half)", () => {
  it("writes no alert row for any month at all — not even the current one", async () => {
    const category = await seedCategoryAndOverallBudget();

    await createInstallmentPlan(
      installmentDeps(),
      { userId: USER, mode: "per_installment", amount: PER_INSTALLMENT, periods: 6, currency: "TWD", categoryId: category.id, startDay: "2026-04-05" },
      budgetAlertDeps(),
    );

    expect(planRows()).toHaveLength(6); // 2026-04-05 .. 2026-09-05
    // Every instalment here is 35 000 against a 40 000 budget, so each one
    // crosses 80% on its own — the fixture cannot pass by being too small.
    //
    // Creating a plan raises nothing at all. The earlier version of this test
    // asserted the *current* month still alerted, following design.md D4b's
    // "month ≤ today" gate. That gate cannot express the rule the docs also
    // state (tasks 6b.2): a plan entered part-way through has every past
    // period at a month ≤ today, so the gate lets them all through and the
    // user gets a burst of "you overspent in March" for months they are only
    // now recording. Decided 2026-08-07: creation is a record of money already
    // committed, and records do not alert.
    expect(budgets.alerts).toEqual([]);
    expect(notifier.messages).toEqual([]);
  });

  it("a backdated plan does not fire for the months it is only now recording", async () => {
    // The case the docs disagreed about, and the one nothing covered in
    // either direction. A mortgage entered part-way through: every period
    // before today is at a month ≤ today, so the "month ≤ today" gate alone
    // lets all of them through — eight real threshold checks, eight pushes,
    // and eight (budget, month, threshold) dedup rows spent on months the
    // user is only now writing down.
    const category = await seedCategoryAndOverallBudget();

    await createInstallmentPlan(
      installmentDeps(),
      { userId: USER, mode: "per_installment", amount: PER_INSTALLMENT, periods: 6, currency: "TWD", categoryId: category.id, startDay: "2025-10-05" },
      budgetAlertDeps(),
    );

    // All six are in the past relative to the fixture's today, each 35 000
    // against a 40 000 budget.
    expect(planRows()).toHaveLength(6);
    expect(planRows().every((r) => r.date < "2026-04")).toBe(true);
    expect(budgets.alerts).toEqual([]);
    expect(notifier.messages).toEqual([]);
  });

  it("a future month's alert is not burned: when that month arrives, a real overspend still rings", async () => {
    const category = await seedCategoryAndOverallBudget();

    await createInstallmentPlan(
      installmentDeps(),
      { userId: USER, mode: "per_installment", amount: PER_INSTALLMENT, periods: 6, currency: "TWD", categoryId: category.id, startDay: "2026-04-05" },
      budgetAlertDeps(),
    );

    expect(planRows()).toHaveLength(6);
    expect(budgets.alerts.filter((a) => a.month === "2026-06")).toEqual([]);

    // June arrives; an ordinary purchase pushes June to 55 000 (35 000
    // instalment + 20 000), crossing BOTH 80% and 100%. If creation had
    // burned (2026-06, 80), only one of the two could ever ring.
    nowIso = "2026-06-15T02:00:00.000Z";
    await createTransaction(
      categories,
      transactions,
      { userId: USER, type: "expense", amount: 20000, currency: "TWD", categoryId: category.id, date: "2026-06-20" },
      budgetAlertDeps(),
    );

    expect(budgets.alerts.filter((a) => a.month === "2026-06")).toHaveLength(2);
    expect(notifier.messages.filter((m) => m.message.body.startsWith("6月"))).toHaveLength(2);
  });
});

describe("the updateTransaction door (design.md D6c: the gate covers update, not just create)", () => {
  it("editing an instalment in a future month does not burn that month's alert row", async () => {
    const category = await seedCategoryAndOverallBudget();

    await createInstallmentPlan(
      installmentDeps(),
      { userId: USER, mode: "per_installment", amount: PER_INSTALLMENT, periods: 6, currency: "TWD", categoryId: category.id, startDay: "2026-04-05" },
      budgetAlertDeps(),
    );

    expect(planRows()).toHaveLength(6);
    const future = planRows().find((t) => t.date === "2026-07-05");
    expect(future).toBeDefined();

    await updateTransaction(
      categories,
      transactions,
      USER,
      future!.id,
      { type: "expense", amount: 36000, currency: "TWD", categoryId: category.id, date: "2026-07-05" },
      budgetAlertDeps(),
    );

    // 36 000/40 000 = 90% — crossed, but 2026-07 > today's month: no row.
    expect(budgets.alerts.filter((a) => a.month === "2026-07")).toEqual([]);
  });

  it("editing an already-due instalment still triggers its month — plan rows are not blanket-suppressed", async () => {
    const category = await seedCategoryAndOverallBudget();

    // Started back in January; today is 2026-04-10, so 01..04 have fallen due.
    await createInstallmentPlan(
      installmentDeps(),
      { userId: USER, mode: "per_installment", amount: PER_INSTALLMENT, periods: 6, currency: "TWD", categoryId: category.id, startDay: "2026-01-05" },
      budgetAlertDeps(),
    );

    expect(planRows()).toHaveLength(6);
    const past = planRows().find((t) => t.date === "2026-02-05");
    expect(past).toBeDefined();

    // The bank retroactively corrected February to 45 000 — now over 100%.
    // 2026-02 ≤ today: this must ring. "plan_id ⇒ never alert" fails here.
    await updateTransaction(
      categories,
      transactions,
      USER,
      past!.id,
      { type: "expense", amount: 45000, currency: "TWD", categoryId: category.id, date: "2026-02-05" },
      budgetAlertDeps(),
    );

    expect(budgets.alerts).toContainEqual(expect.objectContaining({ month: "2026-02", threshold: 100 }));
    expect(notifier.messages.some((m) => m.message.body === "2月支出已超過預算")).toBe(true);
  });
});
