import { InvalidFinanceInputError } from "../domain/errors";
import { NetWorthAccountArchived, NetWorthAccountNotFound } from "../domain/networth-errors";
import type { NetWorthRepository } from "../domain/networth-repository";
import type { NetWorthSnapshot, UpsertNetWorthSnapshotInput } from "../domain/networth-snapshot";

/**
 * Use case: upsert one (account, month) snapshot value. `value` must be a
 * non-negative integer (0 allowed; both assets and liabilities are stored
 * positive). The account must exist, belong to the same user, and not be
 * archived — an archived account rejects new snapshots while its history stays
 * readable (design.md). Upsert overwrites an existing account-month value.
 */
export async function upsertNetWorthSnapshot(
  repository: NetWorthRepository,
  input: UpsertNetWorthSnapshotInput,
): Promise<NetWorthSnapshot> {
  if (!Number.isInteger(input.value) || input.value < 0) {
    throw new InvalidFinanceInputError(`value must be a non-negative integer: ${input.value}`);
  }

  const account = await repository.findAccountById(input.accountId);
  if (!account || account.userId !== input.userId) throw new NetWorthAccountNotFound();
  if (account.archived) throw new NetWorthAccountArchived();

  return repository.upsertSnapshot(input);
}
