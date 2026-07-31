import type { FinanceTransaction } from "../domain/finance-transaction";
import type { FinanceTransactionRepository } from "../domain/finance-transaction-repository";

/** Use case: list the user's transactions with `date` in `[from, to]`. */
export async function listTransactions(
  repository: FinanceTransactionRepository,
  userId: string,
  from: string,
  to: string,
): Promise<FinanceTransaction[]> {
  return repository.listByUserAndRange(userId, from, to);
}
