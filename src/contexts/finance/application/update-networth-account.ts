import { NetWorthAccountNameConflict, NetWorthAccountNotFound } from "../domain/networth-errors";
import type { NetWorthAccount, UpdateNetWorthAccountPatch } from "../domain/networth-account";
import type { NetWorthRepository } from "../domain/networth-repository";

/**
 * Use case: partially update an owned account (name/sort_order/archived).
 * `kind` is immutable — `UpdateNetWorthAccountPatch` has no `kind` field, so
 * there is no code path that could change it. A rename that collides with
 * another of the user's accounts of the same kind is rejected with 400.
 */
export async function updateNetWorthAccount(
  repository: NetWorthRepository,
  userId: string,
  id: string,
  patch: UpdateNetWorthAccountPatch,
): Promise<NetWorthAccount> {
  const existing = await repository.findAccountById(id);
  if (!existing || existing.userId !== userId) throw new NetWorthAccountNotFound();

  if (patch.name !== undefined && patch.name !== existing.name) {
    const duplicate = await repository.findAccountByUserKindName(userId, existing.kind, patch.name);
    if (duplicate) {
      throw new NetWorthAccountNameConflict(`a ${existing.kind} account named "${patch.name}" already exists`);
    }
  }

  const updated = await repository.updateAccount(userId, id, patch);
  if (!updated) throw new NetWorthAccountNotFound();
  return updated;
}
