import { SettlementNotFound } from "../domain/errors";
import type { SettlementRepository } from "../domain/settlement-repository";

/** Use case: delete an owned settlement. Only `created_by_user_id` or `from_user_id` (the payer) may — any other participant gets `SettlementNotFound`. */
export async function deleteSettlement(repository: SettlementRepository, callerUserId: string, settlementId: string): Promise<void> {
  const caller = callerUserId.toLowerCase();

  const existing = await repository.findById(settlementId);
  if (!existing) throw new SettlementNotFound();
  if (existing.createdByUserId !== caller && existing.fromUserId !== caller) throw new SettlementNotFound();

  const deleted = await repository.delete(settlementId);
  if (!deleted) throw new SettlementNotFound();
}
