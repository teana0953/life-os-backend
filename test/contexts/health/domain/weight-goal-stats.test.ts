import { describe, expect, it } from "vitest";
import { computeAchievementRate, computeBmi } from "../../../../src/contexts/health/domain/weight-goal-stats";

describe("computeBmi", () => {
  it("computes BMI to one decimal (52kg, 165cm → 19.1)", () => {
    expect(computeBmi(52, 165)).toBe(19.1);
  });

  it("returns null when weight is null", () => {
    expect(computeBmi(null, 165)).toBeNull();
  });

  it("returns null when height is null", () => {
    expect(computeBmi(52, null)).toBeNull();
  });

  it("returns null when either value is <= 0", () => {
    expect(computeBmi(0, 165)).toBeNull();
    expect(computeBmi(52, 0)).toBeNull();
    expect(computeBmi(-1, 165)).toBeNull();
  });
});

describe("computeAchievementRate", () => {
  it("computes the worked example: baseline 55, current 52, target 51 → 75", () => {
    expect(computeAchievementRate(55, 52, 51)).toBe(75);
  });

  it("clamps to 0 when overshooting below (already past target)", () => {
    // (55 − 50) / (55 − 51) = 125 → clamped to 100
    expect(computeAchievementRate(55, 50, 51)).toBe(100);
    // moving the wrong way: (55 − 56) / (55 − 51) = -25 → clamped to 0
    expect(computeAchievementRate(55, 56, 51)).toBe(0);
  });

  it("returns null when any input is null", () => {
    expect(computeAchievementRate(null, 52, 51)).toBeNull();
    expect(computeAchievementRate(55, null, 51)).toBeNull();
    expect(computeAchievementRate(55, 52, null)).toBeNull();
  });

  it("returns null when baseline equals target", () => {
    expect(computeAchievementRate(51, 52, 51)).toBeNull();
  });

  it("returns null when baseline equals current (single recorded weight)", () => {
    expect(computeAchievementRate(52, 52, 51)).toBeNull();
  });
});
