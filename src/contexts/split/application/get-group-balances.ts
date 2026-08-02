import type { Balance } from "../domain/balance";
import type { BalanceRepository } from "../domain/balance-repository";
import { GroupNotFound } from "../domain/errors";
import type { ExpenseGroupRepository } from "../domain/expense-group-repository";

export interface GetGroupBalancesDeps {
  balances: BalanceRepository;
  groups: ExpenseGroupRepository;
}

/** Use case: every member of the group's net against the whole group. Not a member -> `GroupNotFound`. */
export async function getGroupBalances(deps: GetGroupBalancesDeps, callerUserId: string, groupId: string): Promise<Balance[]> {
  const caller = callerUserId.toLowerCase();
  const members = await deps.groups.membersAmong(groupId, [caller]);
  if (!members.has(caller)) throw new GroupNotFound();
  return deps.balances.balancesForGroup(groupId);
}
