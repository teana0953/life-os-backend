import type { BudgetAlertNotifier } from "../domain/budget-alert-notifier";
import { DEFAULT_CATEGORIES, FALLBACK_CATEGORY_NAME } from "../domain/default-categories";
import type { FinanceBudgetRepository } from "../domain/finance-budget-repository";
import type { FinanceCategoryRepository } from "../domain/finance-category-repository";
import type { MirrorPlanInput, ShareMirrorRow, SharesMirror } from "../../split/domain/shares-mirror";

export interface FinanceSharesMirrorDeps {
  categories: FinanceCategoryRepository;
  /** Used by `afterWrite` only — see its doc. */
  budgets: FinanceBudgetRepository;
  /** Used by `afterWrite` only — see its doc. */
  notifier: BudgetAlertNotifier;
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

  async plan(input: MirrorPlanInput): Promise<ShareMirrorRow[]> {
    const rows: ShareMirrorRow[] = [];
    for (const share of input.shares) {
      rows.push({
        userId: share.userId,
        splitExpenseId: input.splitExpenseId,
        amount: share.amount,
        currency: input.currency,
        categoryId: await this.resolveCategoryId(share.userId, input.categoryName),
        day: input.day,
        // The split's description is the only text there is; from here on the
        // note belongs to the owner and later split edits leave it alone.
        note: input.description,
      });
    }
    return rows;
  }

  /**
   * TODO(mirror-splits-into-ledger §6): run each share holder's budget-alert
   * check here. Deliberately inert in this pass — `budgets` and `notifier`
   * are already wired so that adding it changes nothing but this method.
   */
  async afterWrite(_rows: ShareMirrorRow[]): Promise<void> {}

  /**
   * `finance_transaction.category_id` is NOT NULL, so this has to terminate
   * with an id — a split that cannot be resolved would fail the payer's write
   * because of somebody else's category list (design.md D4).
   *
   * 1. the holder's own **expense** category of that name;
   * 2. otherwise their **expense** 其他 — for an unnamed category as well as
   *    an unmatched one;
   * 3. otherwise re-seed the defaults and take 其他 again.
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
    const seeded = await this.deps.categories.findByUserTypeName(userId, "expense", FALLBACK_CATEGORY_NAME);
    if (seeded) return seeded.id;
    throw new Error(`failed to resolve a mirror category for ${userId}`);
  }
}
