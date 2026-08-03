import { describe, expect, it } from "vitest";
import { groupSettlementDelta, personalSettlementDelta } from "../../../../src/contexts/split/domain/settlement-balance";

const A = "user-a";
const B = "user-b";
const C = "user-c";

// These tests assert a NAMED person's signed figure, never a sum-to-zero
// check — a sum-to-zero check holds under either sign convention (flip both
// branches together and the total is still 0), so it cannot prove the
// direction is right. Only pinning a specific person's number can.

describe("personalSettlementDelta: rows keyed by the counterpart, positive = counterpart owes viewer", () => {
  it("being repaid reduces what they owe: 450 owed, repaid 450 -> settled at 0", () => {
    // Counterpart B owes viewer A 450; B repays A in full.
    const settlement = { fromUserId: B, toUserId: A, amount: 450 };

    const after = 450 + personalSettlementDelta(settlement, A);

    expect(after).toBe(0);
  });

  it("repaying reduces what the caller owes: caller owes 450, repays 300 -> owes 150, not 750", () => {
    // Viewer A owes counterpart B 450 (net -450 from A's perspective); A repays 300 of it.
    const settlement = { fromUserId: A, toUserId: B, amount: 300 };

    const after = -450 + personalSettlementDelta(settlement, A);

    expect(after).toBe(-150);
  });

  it("overpaying flips the balance: caller owes 450, repays 600 -> counterpart now owes caller 150", () => {
    const settlement = { fromUserId: A, toUserId: B, amount: 600 };

    const after = -450 + personalSettlementDelta(settlement, A);

    expect(after).toBe(150);
  });

  it("a full repayment settles both sides of the pair, by name", () => {
    // B owes A 450 (A's net vs B = +450; B's net vs A = -450, the same debt from the other side).
    const settlement = { fromUserId: B, toUserId: A, amount: 450 };

    expect(450 + personalSettlementDelta(settlement, A)).toBe(0);
    expect(-450 + personalSettlementDelta(settlement, B)).toBe(0);
  });

  it("a partial repayment leaves each side's figure consistent, by name", () => {
    // B owes A 450; B repays 300.
    const settlement = { fromUserId: B, toUserId: A, amount: 300 };

    expect(450 + personalSettlementDelta(settlement, A)).toBe(150);
    expect(-450 + personalSettlementDelta(settlement, B)).toBe(-150);
  });

  it("contributes nothing to a viewer the settlement does not name", () => {
    const settlement = { fromUserId: B, toUserId: C, amount: 100 };

    expect(personalSettlementDelta(settlement, A)).toBe(0);
  });
});

describe("groupSettlementDelta: rows keyed by the member themselves, positive = the member is a creditor", () => {
  it("a repaying group member moves toward zero, by name: B owes 450, repays 300 to A -> B is -150, A is +150", () => {
    const settlement = { fromUserId: B, toUserId: A, amount: 300 };

    expect(-450 + groupSettlementDelta(settlement, B)).toBe(-150);
    expect(450 + groupSettlementDelta(settlement, A)).toBe(150);
  });

  it("a full repayment brings a group debtor to zero, not to owing more", () => {
    // This is the exact failure design.md warns about: the wrong sign here
    // would show a fully-repaying debtor at -900 instead of 0.
    const settlement = { fromUserId: B, toUserId: A, amount: 450 };

    expect(-450 + groupSettlementDelta(settlement, B)).toBe(0);
    expect(450 + groupSettlementDelta(settlement, A)).toBe(0);
  });

  it("a group still nets to zero after a repayment — a sanity check, not the direction check", () => {
    const settlement = { fromUserId: B, toUserId: A, amount: 300 };
    const aAfter = 450 + groupSettlementDelta(settlement, A);
    const bAfter = -450 + groupSettlementDelta(settlement, B);

    expect(aAfter + bAfter).toBe(0);

    // The sum-to-zero check alone cannot prove the direction: flipping both
    // signs together (the exact bug this module exists to prevent) still
    // sums to zero.
    const aAfterFlipped = 450 - groupSettlementDelta(settlement, A);
    const bAfterFlipped = -450 - groupSettlementDelta(settlement, B);
    expect(aAfterFlipped + bAfterFlipped).toBe(0);
    // But the flipped figures are wrong by name: the debtor now looks like
    // they owe more after repaying, exactly the bug design.md describes.
    expect(bAfterFlipped).toBe(-750);
  });

  it("contributes nothing to a member the settlement does not name", () => {
    const settlement = { fromUserId: B, toUserId: C, amount: 100 };

    expect(groupSettlementDelta(settlement, A)).toBe(0);
  });
});
