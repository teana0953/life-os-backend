import { GroupNotFound, InvalidSplitInput } from "../domain/errors";
import type { ExpenseGroupRepository } from "../domain/expense-group-repository";
import type { Settlement } from "../domain/settlement";
import type { ListSettlementsFilter, SettlementRepository } from "../domain/settlement-repository";
import { participatesInSettlement } from "./settlement-participation";

export interface ListSettlementsDeps {
  settlements: SettlementRepository;
  groups: ExpenseGroupRepository;
}

/**
 * Use case: list the caller's settlements. `groupId` and `withUserId` are
 * mutually exclusive (400 if both are given); neither given lists every
 * settlement the caller is a party to or can see via group membership —
 * same filtering semantics as `listExpenses`.
 *
 * The repository is expected to filter in SQL, but (same accepted gap as
 * `listExpenses`) that path has no test coverage anywhere in this repo, so
 * this use case re-asserts participation on every returned row and drops
 * anything that fails, treating a failure as a programming error rather than
 * trusting the query alone.
 */
export async function listSettlements(deps: ListSettlementsDeps, callerUserId: string, filter: ListSettlementsFilter): Promise<Settlement[]> {
  const caller = callerUserId.toLowerCase();

  if (filter.groupId !== undefined && filter.withUserId !== undefined) {
    throw new InvalidSplitInput("group_id and with cannot both be given");
  }

  const callerGroupIds = new Set<string>();
  if (filter.groupId !== undefined) {
    const members = await deps.groups.membersAmong(filter.groupId, [caller]);
    if (!members.has(caller)) throw new GroupNotFound();
    callerGroupIds.add(filter.groupId.toLowerCase());
  }

  const rows = await deps.settlements.listForUser(caller, filter);

  const unresolvedGroupIds = new Set<string>();
  for (const row of rows) {
    if (row.groupId === null) continue;
    const groupId = row.groupId.toLowerCase();
    if (callerGroupIds.has(groupId)) continue;
    if (participatesInSettlement(row, caller, callerGroupIds)) continue;
    unresolvedGroupIds.add(groupId);
  }
  for (const groupId of unresolvedGroupIds) {
    const members = await deps.groups.membersAmong(groupId, [caller]);
    if (members.has(caller)) callerGroupIds.add(groupId);
  }

  const verified: Settlement[] = [];
  for (const row of rows) {
    if (participatesInSettlement(row, caller, callerGroupIds)) {
      verified.push(row);
    } else {
      console.error("listSettlements: dropped a row the caller does not participate in", { settlementId: row.id, callerUserId: caller });
    }
  }
  return verified;
}
