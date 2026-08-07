import { beforeEach, describe, expect, it } from "vitest";
import { FinanceSharesMirror } from "../../../../src/contexts/finance/adapters/finance-shares-mirror";
import type { MirrorPlanInput } from "../../../../src/contexts/split/domain/shares-mirror";
import { FakeBudgetAlertNotifier, InMemoryFinanceBudgetRepository, InMemoryFinanceCategoryRepository, InMemoryFinanceTransactionRepository } from "../fakes";

/**
 * split-installments tasks 1.2 / 2.2–2.4: a share carrying a repayment
 * schedule is mirrored **one transaction per period, instead of the lump**
 * (condition inversion, never addition), and the period dates are anchored on
 * the split's day.
 *
 * RED PHASE (openspec/changes/split-installments): `SplitShareInput` has no
 * `schedule` field yet, so the fixtures cast it in — `plan` ignores it today
 * and returns one lump row, which is exactly what these assertions refuse.
 *
 * The three mirror cases are a set; drop one and a wrong implementation
 * survives:
 * - "sum equals the share"      kills  lump + periods   (6000 + 12×500 = 18000)
 * - "twelve rows of 500"        kills  lump only        (today's behavior)
 * - "unscheduled share is one"  kills  split everything (schedule leaking onto
 *                                      shares that never asked for one)
 */

const A = "11111111-1111-1111-1111-111111111111"; // payer, own share NOT scheduled
const B = "22222222-2222-2222-2222-222222222222"; // share holder repaying monthly
const E1 = "e1111111-1111-1111-1111-111111111111";

type PlanShare = MirrorPlanInput["shares"][number];

/**
 * A share, optionally on a repayment schedule. The `as` cast is the red-phase
 * seam: once `schedule` exists on the share input type this cast is a no-op.
 */
function share(userId: string, amount: number, schedule?: { periods: number; perPeriodAmount: number }): PlanShare {
  return (schedule ? { userId, amount, schedule } : { userId, amount }) as PlanShare;
}

function planInput(overrides: Partial<MirrorPlanInput> = {}): MirrorPlanInput {
  return {
    splitExpenseId: E1,
    currency: "TWD",
    day: "2026-01-15",
    description: "annual fee, half each",
    categoryName: null,
    shares: [share(A, 6000), share(B, 6000, { periods: 12, perPeriodAmount: 500 })],
    ...overrides,
  };
}

describe("FinanceSharesMirror.plan with a repayment schedule", () => {
  let categories: InMemoryFinanceCategoryRepository;
  let mirror: FinanceSharesMirror;

  beforeEach(async () => {
    categories = new InMemoryFinanceCategoryRepository();
    // Every holder already has an expense 其他, so category resolution is not
    // what any of these cases is about.
    await categories.create({ userId: A, name: "其他", type: "expense" });
    await categories.create({ userId: B, name: "其他", type: "expense" });
    mirror = new FinanceSharesMirror({
      categories,
      budgets: new InMemoryFinanceBudgetRepository(new InMemoryFinanceTransactionRepository()),
      notifier: new FakeBudgetAlertNotifier(),
    });
  });

  it("mirrors a scheduled share as its periods only — the total stays the share, never share + periods (2.2)", async () => {
    const rows = await mirror.plan(planInput());
    const forB = rows.filter((row) => row.userId === B);

    // The double-count guard: recording the lump AND the periods sums to
    // 6000 + 12×500 = 18000 of spending for 6000 of expense.
    expect(forB.reduce((sum, row) => sum + row.amount, 0)).toBe(6000);
    // Without this the lump alone (also summing to 6000) would pass.
    expect(forB).toHaveLength(12);
  });

  it("puts twelve 500s in the holder's ledger, not one 6000 (2.3)", async () => {
    const rows = await mirror.plan(planInput());
    const forB = rows.filter((row) => row.userId === B);

    expect(forB.map((row) => row.amount)).toEqual(Array.from({ length: 12 }, () => 500));
  });

  it("leaves a share without a schedule as one lump row, even on the same expense (2.4)", async () => {
    const rows = await mirror.plan(planInput());

    // The scheduled share really went down the schedule path…
    expect(rows.filter((row) => row.userId === B)).toHaveLength(12);
    // …and the unscheduled one did NOT get dragged along. Without this,
    // "split every share whenever the expense has a schedule anywhere" —
    // and even "always split" — survive the two cases above.
    const forA = rows.filter((row) => row.userId === A);
    expect(forA).toHaveLength(1);
    expect(forA[0]?.amount).toBe(6000);
  });

  it("anchors every period on the split's day — the third period of a 1/31 start is 3/31, not 3/28 (1.2)", async () => {
    const rows = await mirror.plan(
      planInput({ day: "2026-01-31", shares: [share(B, 6000, { periods: 12, perPeriodAmount: 500 })] }),
    );
    const days = rows
      .filter((row) => row.userId === B)
      .map((row) => row.day)
      .sort();

    // Period 1 is the split's day itself — the same convention as #82, where
    // startDay is the first instalment's date.
    expect(days[0]).toBe("2026-01-31");
    // Both the anchored and the drifting implementation agree here…
    expect(days[1]).toBe("2026-02-28");
    // …and only the third period tells them apart: successive increment
    // drifts to 2026-03-28 and never comes back (#82 stepped on this).
    expect(days[2]).toBe("2026-03-31");
  });
});
