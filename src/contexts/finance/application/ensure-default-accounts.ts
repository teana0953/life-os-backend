import { DEFAULT_NETWORTH_ACCOUNTS } from "../domain/default-networth-accounts";
import type { NetWorthRepository } from "../domain/networth-repository";

/**
 * Use case: seed the user's default net-worth accounts the first time they have
 * none at all (including archived) — never re-seeds once any account exists.
 * Idempotent: the repository's `insertDefaultAccountsIfMissing` skips rows that
 * already exist (the `(user_id, kind, name)` unique index), so a concurrent
 * double-call never duplicates.
 */
export async function ensureDefaultAccounts(repository: NetWorthRepository, userId: string): Promise<void> {
  const existing = await repository.listAccounts(userId);
  if (existing.length > 0) return;
  await repository.insertDefaultAccountsIfMissing(DEFAULT_NETWORTH_ACCOUNTS.map((a) => ({ ...a, userId })));
}
