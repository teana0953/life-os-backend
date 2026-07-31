import type { NetWorthAccount } from "../domain/networth-account";
import type { NetWorthRepository } from "../domain/networth-repository";
import { ensureDefaultAccounts } from "./ensure-default-accounts";

/** Use case: list the user's net-worth accounts, lazily seeding the defaults first when the user has none. */
export async function listNetWorthAccounts(repository: NetWorthRepository, userId: string): Promise<NetWorthAccount[]> {
  await ensureDefaultAccounts(repository, userId);
  return repository.listAccounts(userId);
}
