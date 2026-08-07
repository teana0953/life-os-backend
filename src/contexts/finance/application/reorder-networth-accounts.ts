import { NetWorthAccountOrderMismatch, NetWorthInvalidKind } from "../domain/networth-errors";
import type { NetWorthKind } from "../domain/networth-account";
import type { NetWorthRepository } from "../domain/networth-repository";

/**
 * Use case: atomically reorder all of the user's accounts of one `kind`
 * (issue #80). `orderedIds` must be exactly the set of the user's account ids
 * of that `kind` — including archived ones, which live in the same ordering
 * space — never a subset, a superset, or another user's/kind's id. Any
 * mismatch rejects with `NetWorthAccountOrderMismatch` (400) and writes
 * nothing; only an exact match reaches the repository's atomic write.
 */
export async function reorderNetWorthAccounts(
  repository: NetWorthRepository,
  userId: string,
  kind: NetWorthKind,
  orderedIds: string[],
): Promise<void> {
  if (kind !== "asset" && kind !== "liability") {
    throw new NetWorthInvalidKind(`kind must be "asset" or "liability": ${kind}`);
  }

  const existingIds = (await repository.listAccounts(userId)).filter((a) => a.kind === kind).map((a) => a.id);
  const givenIds = new Set(orderedIds);

  const isExactSet =
    orderedIds.length === existingIds.length && givenIds.size === orderedIds.length && existingIds.every((id) => givenIds.has(id));
  if (!isExactSet) {
    throw new NetWorthAccountOrderMismatch(`ids must be exactly the user's ${kind} account ids`);
  }

  await repository.reorderAccounts(userId, kind, orderedIds);
}
