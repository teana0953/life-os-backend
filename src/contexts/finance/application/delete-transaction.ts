import { FinanceTransactionNotFound, MirroredTransactionReadOnly } from "../domain/errors";
import type { FinanceTransactionRepository } from "../domain/finance-transaction-repository";

/**
 * Use case: delete an owned transaction; throws FinanceTransactionNotFound
 * when not owned/found.
 *
 * A mirrored transaction is refused: it is the split's fact, and deleting it
 * on this side alone would leave the two views disagreeing forever (design.md
 * D7). The refusal needs a read this use case did not previously do — the
 * alternative, folding `split_expense_id is null` into the repository's
 * predicate, would answer 404 for a row the caller owns and can see in their
 * own listing.
 */
export async function deleteTransaction(repository: FinanceTransactionRepository, userId: string, id: string): Promise<void> {
  const existing = await repository.findById(id);
  if (!existing || existing.userId !== userId) throw new FinanceTransactionNotFound();
  if (existing.splitExpenseId !== null) throw new MirroredTransactionReadOnly("a transaction mirrored from a split expense cannot be deleted here");

  const deleted = await repository.delete(userId, id);
  if (!deleted) throw new FinanceTransactionNotFound();
}
