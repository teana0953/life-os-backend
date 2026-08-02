import { describe, expect, it } from "vitest";
import { InvalidSplitInput, SharesDoNotSumToAmount } from "../../../../src/contexts/split/domain/errors";
import { equalSplit, validateExactSplit } from "../../../../src/contexts/split/domain/split-calculator";

// Lowercase canonical order: aaa... < bbb... < ccc...
const A = "aaaaaaaa-0000-0000-0000-000000000000";
const B = "bbbbbbbb-0000-0000-0000-000000000000";
const C = "cccccccc-0000-0000-0000-000000000000";

describe("equalSplit", () => {
  it("splits 100 among 3 as 34/33/33, the remainder going to the first participant in canonical order", () => {
    const shares = equalSplit(100, [C, A, B]);

    expect(shares).toEqual([
      { userId: A, amount: 34 },
      { userId: B, amount: 33 },
      { userId: C, amount: 33 },
    ]);
    expect(shares.reduce((sum, s) => sum + s.amount, 0)).toBe(100);
  });

  it("splits 1 among 3 as 1/0/0", () => {
    const shares = equalSplit(1, [C, A, B]);

    expect(shares).toEqual([
      { userId: A, amount: 1 },
      { userId: B, amount: 0 },
      { userId: C, amount: 0 },
    ]);
  });

  it("is reproducible: the same amount and participants always split the same way", () => {
    const first = equalSplit(100, [C, A, B]);
    const second = equalSplit(100, [A, B, C]);

    expect(first).toEqual(second);
  });

  it("splits 7 among 10 people with only integer arithmetic", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `${i}${i}${i}${i}${i}${i}${i}${i}-0000-0000-0000-000000000000`);
    const shares = equalSplit(7, ids);

    expect(shares.reduce((sum, s) => sum + s.amount, 0)).toBe(7);
    expect(shares.filter((s) => s.amount === 1)).toHaveLength(7);
    expect(shares.filter((s) => s.amount === 0)).toHaveLength(3);
    for (const share of shares) expect(Number.isInteger(share.amount)).toBe(true);
  });

  it("always sums to the original amount, across a range of amounts and participant counts", () => {
    const amounts = [0, 1, 2, 3, 7, 10, 99, 100, 101, 12345];
    const counts = [1, 2, 3, 4, 5, 7, 11];
    for (const amount of amounts) {
      for (const n of counts) {
        const ids = Array.from({ length: n }, (_, i) => `${i}0000000-0000-0000-0000-00000000000${i}`);
        const shares = equalSplit(amount, ids);
        expect(shares.reduce((sum, s) => sum + s.amount, 0)).toBe(amount);
      }
    }
  });
});

describe("validateExactSplit", () => {
  it("accepts shares that sum exactly to the amount", () => {
    expect(() => validateExactSplit(900, [{ userId: A, amount: 300 }, { userId: B, amount: 600 }])).not.toThrow();
  });

  it("rejects a short split rather than topping it up", () => {
    expect(() => validateExactSplit(900, [{ userId: A, amount: 800 }])).toThrow(SharesDoNotSumToAmount);
  });

  it("rejects a long split rather than trimming it", () => {
    expect(() => validateExactSplit(900, [{ userId: A, amount: 1000 }])).toThrow(SharesDoNotSumToAmount);
  });

  it("states the discrepancy on the error", () => {
    try {
      validateExactSplit(900, [{ userId: A, amount: 800 }]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SharesDoNotSumToAmount);
      expect((err as SharesDoNotSumToAmount).message).toContain("100");
    }
  });

  it("rejects a negative share", () => {
    expect(() => validateExactSplit(900, [{ userId: A, amount: 1000 }, { userId: B, amount: -100 }])).toThrow(InvalidSplitInput);
  });
});
