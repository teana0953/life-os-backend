import { FinanceBudgetNotFound } from "../domain/errors";
import type { FinanceBudgetRepository } from "../domain/finance-budget-repository";

/** Use case: delete an owned budget; throws FinanceBudgetNotFound when not owned/found. Its alerts cascade via FK (design.md). */
export async function deleteBudget(repository: FinanceBudgetRepository, userId: string, id: string): Promise<void> {
  const deleted = await repository.delete(userId, id);
  if (!deleted) throw new FinanceBudgetNotFound();
}
