import type { SplitSpendingRepository } from "../domain/split-spending-repository";
import type { SplitSpendingAmount } from "../domain/split-spending";

/**
 * Use case: the caller's own split-expense shares for `month` (`YYYY-MM`),
 * per currency. A thin pass-through — the rules that make this figure
 * different from a balance ("count the payer's own share", "never count a
 * settlement") are properties of what `split_share` holds, not something
 * this use case has to compute (see `SplitSpendingRepository.splitSpendingForUser`).
 */
export async function getSplitSpending(repository: SplitSpendingRepository, userId: string, month: string): Promise<SplitSpendingAmount[]> {
  return repository.splitSpendingForUser(userId.toLowerCase(), month);
}
