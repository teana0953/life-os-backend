import type { Settlement } from "../domain/settlement";

/**
 * Whether `userId` may see `settlement`: its payer, its payee, or — when it
 * names a group — a member of that group. `listSettlements` uses this as a
 * second, in-memory assertion on top of the repository's own filtering
 * (same accepted gap as `participatesInExpense`: the SQL path has no test
 * coverage in this repo).
 */
export function participatesInSettlement(settlement: Settlement, userId: string, callerGroupIds: ReadonlySet<string>): boolean {
  const id = userId.toLowerCase();
  if (settlement.fromUserId === id || settlement.toUserId === id) return true;
  return settlement.groupId !== null && callerGroupIds.has(settlement.groupId.toLowerCase());
}
