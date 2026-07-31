import { NetWorthAccountNameConflict, NetWorthInvalidKind } from "../domain/networth-errors";
import type { CreateNetWorthAccountInput, NetWorthAccount } from "../domain/networth-account";
import type { NetWorthRepository } from "../domain/networth-repository";

/**
 * Use case: create a net-worth account. Validates `kind` and rejects a
 * duplicate (user, kind, name) by checking first — never lets the
 * `(user_id, kind, name)` unique-index violation surface as a raw 500
 * (design.md). An out-of-set `kind` is `NetWorthInvalidKind`; a duplicate name
 * is `NetWorthAccountNameConflict` (both mapped to 400, distinct semantics).
 */
export async function createNetWorthAccount(repository: NetWorthRepository, input: CreateNetWorthAccountInput): Promise<NetWorthAccount> {
  if (input.kind !== "asset" && input.kind !== "liability") {
    throw new NetWorthInvalidKind(`kind must be "asset" or "liability": ${input.kind}`);
  }

  const duplicate = await repository.findAccountByUserKindName(input.userId, input.kind, input.name);
  if (duplicate) {
    throw new NetWorthAccountNameConflict(`a ${input.kind} account named "${input.name}" already exists`);
  }

  return repository.createAccount(input);
}
