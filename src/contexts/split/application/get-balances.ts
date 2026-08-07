import type { Balance } from "../domain/balance";
import type { BalanceRepository } from "../domain/balance-repository";

/** Use case: the caller's net against every other person they have a shared expense with, per currency. */
export async function getBalances(repository: BalanceRepository, userId: string, today: string): Promise<Balance[]> {
  return repository.balancesForUser(userId.toLowerCase(), today);
}
