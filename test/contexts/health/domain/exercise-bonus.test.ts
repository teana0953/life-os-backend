import { describe, expect, it } from "vitest";
import { exerciseBonusPortions } from "../../../../src/contexts/health/domain/exercise-bonus";

describe("exerciseBonusPortions", () => {
  it("earns one whole portion per 30 minutes, ignoring a partial block", () => {
    expect(exerciseBonusPortions(0)).toBe(0);
    expect(exerciseBonusPortions(29)).toBe(0);
    expect(exerciseBonusPortions(30)).toBe(1);
    expect(exerciseBonusPortions(45)).toBe(1);
    expect(exerciseBonusPortions(60)).toBe(2);
  });

  it("caps the bonus so a very long day can't inflate the target", () => {
    expect(exerciseBonusPortions(8 * 30)).toBe(8);
    expect(exerciseBonusPortions(100 * 30)).toBe(8);
  });

  it("treats non-positive input as no bonus", () => {
    expect(exerciseBonusPortions(-10)).toBe(0);
  });
});
