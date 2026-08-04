/** The shape both balance queries' settlement legs need: who paid whom, how much. */
export interface SettlementLike {
  fromUserId: string;
  toUserId: string;
  amount: number;
}

/**
 * These two functions are the single written source of truth for the sign a
 * settlement contributes to each of the two balance queries. Part 2's
 * `DrizzleBalanceRepository` transcribes these signs into hand-written SQL
 * `UNION ALL` legs — the CTEs must carry a comment pointing back to whichever
 * function they copy. These tests prove the two functions below are correct
 * against design.md's worked examples; that the hand-written CTEs match them
 * is proven separately by `test/db/balances.test.ts`, which executes that SQL
 * against a real Postgres and was shown to fail when either query's
 * settlement signs are swapped.
 *
 * The two balance queries key their rows by different people (personal: the
 * *counterpart*; group: the member *themselves*), and design.md is emphatic
 * that this repo's first draft wrongly assumed the group side could reuse
 * the same reasoning ("群組餘額同理" — "the group balance follows
 * analogously" — which the second review round called out as wrong). Kept
 * as two independent functions, each derived and tested straight from
 * design.md's own formula and worked examples, rather than one shared
 * helper, precisely so that kind of by-analogy mistake has nowhere to hide:
 * a shared function forces one derivation to be reused for both call sites,
 * and reasoning by analogy from the *expense* portion of either query — where
 * a payer contributes `+` and a share holder contributes `-` — is exactly
 * the trap. A settlement has no payer/share-holder asymmetry (it is a plain
 * pairwise transfer), so pattern-matching "the one who sends money" onto
 * "the share holder, who contributes `-`" gets the settlement leg backwards:
 * a debtor who repays would go on looking like a debtor who owes *more*,
 * with no error and no failing test (see `groupSettlementDelta`'s doc for
 * why the group-sum-to-zero invariant cannot catch this either).
 */

/**
 * `balancesForUser`'s convention: each row is keyed by the *counterpart*, and
 * a positive amount means the counterpart owes the viewer.
 *
 * A settlement FROM the counterpart TO the viewer is the counterpart paying
 * off what they owe — it SUBTRACTS from "counterpart owes viewer". A
 * settlement FROM the viewer TO the counterpart is the viewer paying off what
 * *they* owe the counterpart — it ADDS (moves the net away from negative,
 * i.e. away from "viewer owes counterpart").
 *
 * Returns 0 if `settlement` does not name `viewerId` at all — callers only
 * invoke this for settlements already known to involve the viewer as payer
 * or payee.
 */
export function personalSettlementDelta(settlement: SettlementLike, viewerId: string): number {
  if (settlement.toUserId === viewerId) return -settlement.amount;
  if (settlement.fromUserId === viewerId) return settlement.amount;
  return 0;
}

/**
 * `balancesForGroup`'s convention: each row is keyed by the member
 * *themselves* (an expense's payer contributes `+`, a share holder `-`), and
 * a positive amount means that member is a net creditor of the group.
 *
 * A settlement where the member is the sender (`fromUserId`) reduces what
 * they owe the group — it ADDS (moves their own figure up, toward being a
 * creditor). A settlement where the member is the recipient (`toUserId`)
 * reduces what they are owed — it SUBTRACTS.
 *
 * Written out, this lands on the same `to → subtract, from → add` shape as
 * `personalSettlementDelta` — because a settlement, unlike an expense, has
 * no payer/share-holder asymmetry to invert: it is a direct transfer between
 * exactly the two people it names, so "does this row's subject send or
 * receive" means the same thing whether the subject is "the viewer" or "the
 * member itself". That coincidence is exactly why this function is written
 * and tested on its own rather than assumed equal to the other one by
 * inspection: the risk this codebase has already hit once is reasoning by
 * analogy from the *expense* portion's `+`/`-` pattern (payer `+`, share
 * holder `-`) instead of rederiving the settlement leg from design.md's own
 * formula, which is what flips this sign in practice.
 *
 * Group balances still sum to zero per currency after this is applied (every
 * settlement's `+amount` on one member is matched by an equal `-amount` on
 * another), but that sum is only a sanity check, never a direction check —
 * flipping both branches' signs together still sums to zero and would still
 * pass. The direction is only pinned by asserting a named member's signed
 * figure (design.md, tasks.md 2.3b).
 *
 * Returns 0 if `settlement` does not name `memberId` at all.
 */
export function groupSettlementDelta(settlement: SettlementLike, memberId: string): number {
  if (settlement.fromUserId === memberId) return settlement.amount;
  if (settlement.toUserId === memberId) return -settlement.amount;
  return 0;
}
