import { FinanceTransactionNotFound } from "../domain/errors";
import type { FinanceTransactionRepository } from "../domain/finance-transaction-repository";

/** Use case: delete an owned transaction; throws FinanceTransactionNotFound when not owned/found. */
export async function deleteTransaction(repository: FinanceTransactionRepository, userId: string, id: string): Promise<void> {
  const deleted = await repository.delete(userId, id);
  if (!deleted) throw new FinanceTransactionNotFound();
}
