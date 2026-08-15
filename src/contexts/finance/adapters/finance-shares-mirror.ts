import { checkBudgetAlerts } from "../application/check-budget-alerts";
import { addMonthsAnchored } from "../application/installment-support";
import type { BudgetAlertNotifier } from "../domain/budget-alert-notifier";
import { isSupportedCurrency } from "../domain/currency";
import { DEFAULT_CATEGORIES, FALLBACK_CATEGORY_NAME } from "../domain/default-categories";
import type { FinanceBudgetRepository } from "../domain/finance-budget-repository";
import type { FinanceCategoryRepository } from "../domain/finance-category-repository";
import type { MirrorPlanInput, ShareMirrorRow, SharesMirror } from "../../split/domain/shares-mirror";
import { describeErrorChain } from "../../../shared-kernel/error-logging";

export interface FinanceSharesMirrorDeps {
  categories: FinanceCategoryRepository;
  /** Used by `afterWrite` only — see its doc. */
  budgets: FinanceBudgetRepository;
  /** Used by `afterWrite` only — see its doc. */
  notifier: BudgetAlertNotifier;
  /**
   * Used by `afterWrite` to gate budget alerts (add-installments design.md D4b).
   * When provided, a share holder is only alerted if the transaction's month
   * ≤ their own today's month; absent, alerts are not gated (pre-D4b behavior).
   * Both must be supplied together or omitted together.
   */
  now?: () => Date;
  /**
   * Used by `afterWrite` to gate budget alerts (add-installments design.md D4b).
   * When provided, a share holder is only alerted if the transaction's month
   * ≤ their own today's month; absent, alerts are not gated (pre-D4b behavior).
   * Both must be supplied together or omitted together.
   */
  getUserTimezone?: (userId: string) => Promise<string>;
}

/**
 * Driven adapter: finance's implementation of split's `SharesMirror` port
 * (design.md D2). The dependency points finance -> split; split never imports
 * anything from here. It is composed in `createApp` out of repositories that
 * are already injected there, deliberately *not* as a new `CreateAppOptions`
 * field — a field would let a route test pass a fake and turn the category
 * resolution below back into something no test actually exercises.
 *
 * It does not need the transaction repository: the mirrors are written by
 * `SplitExpenseRepository` inside the split's own batch, so they never travel
 * through finance's own write path.
 */
export class FinanceSharesMirror implements SharesMirror {
  constructor(private readonly deps: FinanceSharesMirrorDeps) {}

  /**
   * Who gets a mirror, and what is in it.
   *
   * **A currency outside finance's whitelist produces none at all**, and the
   * split is still written: a transaction cannot hold it, and widening the
   * whitelist would hand clients a currency whose decimal places they render
   * wrong — worse than not showing the money (design.md D10). Those amounts
   * stay visible through `GET /api/finance/split-spending`, which marks them
   * as not counted in the ledger.
   *
   * **A zero share produces none either.** Split allows one (owing nothing on
   * a shared meal is a real situation), finance requires a positive amount,
   * and `finance_transaction.amount` has no CHECK — so a zero written here
   * would land in the ledger silently.
   *
   * Only the share holders are iterated, which is the whole rule for the
   * payer too: fronting money for other people is lending, not spending, so a
   * payer holding no share gets nothing, and one holding a share gets that
   * share rather than the bill.
   *
   * **A share on a repayment schedule (split-installments proposal.md) is a
   * condition inversion, not an addition.** Without a schedule, a share is
   * mirrored as before: one lump row for the whole amount. With one, it is
   * mirrored as `schedule.periods` rows of `schedule.perPeriodAmount` each,
   * anchored on the split's day via `addMonthsAnchored` (the same
   * never-drift-off-the-original-day rule #82 established), and the lump row
   * is **not** also written — that would record the same money twice (6,000
   * + 12×500 = 18,000 of spending for 6,000 of expense). Each period row
   * carries a 1-based `installmentNo`; the lump path leaves it unset.
   */
  async plan(input: MirrorPlanInput): Promise<ShareMirrorRow[]> {
    if (!isSupportedCurrency(input.currency)) return [];

    const rows: ShareMirrorRow[] = [];
    for (const share of input.shares) {
      if (share.amount <= 0) continue;
      const categoryId = await this.resolveCategoryId(share.userId, input.categoryName);
      if (share.schedule) {
        for (let period = 1; period <= share.schedule.periods; period++) {
          if (share.schedule.perPeriodAmount <= 0) continue;
          rows.push({
            userId: share.userId,
            splitExpenseId: input.splitExpenseId,
            amount: share.schedule.perPeriodAmount,
            currency: input.currency,
            categoryId,
            day: addMonthsAnchored(input.day, period - 1),
            note: input.description,
            installmentNo: period,
          });
        }
        continue;
      }
      rows.push({
        userId: share.userId,
        splitExpenseId: input.splitExpenseId,
        amount: share.amount,
        currency: input.currency,
        categoryId,
        day: input.day,
        // The split's description is the only text there is; from here on the
        // note belongs to the owner and later split edits leave it alone.
        note: input.description,
      });
    }
    return rows;
  }

  /**
   * Runs every share holder's budget-alert check, the same one
   * `createTransaction` runs for a transaction they wrote themselves (#76).
   * A holder is notified about their own budget even though somebody else's
   * action crossed it — that is the point, not an accident (design.md D13).
   *
   * One holder's failure must not silence the rest. `writeMirrorAftermath`
   * owns the best-effort contract for the *step* — it is what keeps a failed
   * check from failing the split write — but it sits outside this loop, so
   * without a per-row catch the first holder to throw would abandon every
   * holder after them. Alerts are month-deduped and only fire on the way up,
   * so those holders would not simply be late: they would never be told at
   * all. The two catches are not the same rule twice; this one decides who
   * still gets checked, that one decides whether the split write survives.
   *
   * Only the categories the mirrors carry *now* are checked. An edit that
   * moved a mirror off a category cannot have raised that category's spend,
   * and this check only ever fires on the way up (design.md D19).
   *
   * **Budget alert gating (add-installments design.md D4b):** when `now` and
   * `getUserTimezone` are supplied, a share holder is only alerted if the
   * transaction's month ≤ their own today's month. Without them, every share's
   * month is checked identically (pre-D4b behavior). Both must be supplied
   * together or omitted together.
   */
  async afterWrite(rows: ShareMirrorRow[]): Promise<void> {
    for (const row of rows) {
      try {
        await checkBudgetAlerts(
          {
            budgetRepository: this.deps.budgets,
            categoryRepository: this.deps.categories,
            notifier: this.deps.notifier,
            now: this.deps.now,
            getUserTimezone: this.deps.getUserTimezone,
          },
          { userId: row.userId, type: "expense", currency: row.currency, categoryId: row.categoryId, date: row.day },
        );
      } catch (error) {
        console.error("budget alert check failed for a split mirror", { userId: row.userId, error: describeErrorChain(error) });
      }
    }
  }

  /**
   * `finance_transaction.category_id` is NOT NULL, so this has to terminate
   * with an id — a split that cannot be resolved would fail the payer's write
   * because of somebody else's category list (design.md D4).
   *
   * 1. the holder's own **expense** category of that name;
   * 2. otherwise their **expense** 其他 — for an unnamed category as well as
   *    an unmatched one;
   * 3. otherwise re-seed the defaults and **retry from step 1**.
   *
   * Step 3 retries from the top, not from step 2: the re-seed creates 餐飲
   * alongside 其他, so a holder who has never opened the ledger and is given
   * a share on a 餐飲 split should land on their brand-new 餐飲 — handing
   * back to step 2 would file it under 其他 while the right category sat
   * there unused.
   *
   * **Both lookups are pinned to `type = 'expense'`** because 其他 exists as
   * an income category too: landing there would file the money as income for
   * `getMonthlySummaryRaw`'s per-category grouping, and nothing about it
   * would look wrong.
   *
   * **Step 3 triggers on "其他 is missing", not on "no categories at all".**
   * Categories can be renamed and are never hard-deleted, so a holder who
   * renamed their 其他 still has plenty of categories and the narrower
   * condition would never fire for them. `insertDefaultsIfMissing` dedupes on
   * `(user_id, type, name)`, so after a rename that slot is free and the
   * re-seed genuinely recreates it — which is why one retry suffices and no
   * loop is needed.
   *
   * **There is deliberately no fourth step falling back to any expense
   * category.** With step 3 correct it is unreachable, and its only
   * observable effect would be to make the test for step 3 unable to fail.
   */
  private async resolveCategoryId(userId: string, categoryName: string | null): Promise<string> {
    if (categoryName !== null) {
      const named = await this.deps.categories.findByUserTypeName(userId, "expense", categoryName);
      if (named) return named.id;
    }

    const fallback = await this.deps.categories.findByUserTypeName(userId, "expense", FALLBACK_CATEGORY_NAME);
    if (fallback) return fallback.id;

    await this.deps.categories.insertDefaultsIfMissing(DEFAULT_CATEGORIES.map((category) => ({ ...category, userId })));

    if (categoryName !== null) {
      const seededNamed = await this.deps.categories.findByUserTypeName(userId, "expense", categoryName);
      if (seededNamed) return seededNamed.id;
    }
    const seeded = await this.deps.categories.findByUserTypeName(userId, "expense", FALLBACK_CATEGORY_NAME);
    if (seeded) return seeded.id;
    throw new Error(`failed to resolve a mirror category for ${userId}`);
  }
}
