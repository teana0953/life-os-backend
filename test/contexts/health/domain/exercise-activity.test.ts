import { describe, expect, it } from "vitest";
import { EXERCISE_ACTIVITIES, findActivity } from "../../../../src/contexts/health/domain/exercise-activity";

describe("findActivity", () => {
  it("returns the activity when the id is in the library", () => {
    const known = EXERCISE_ACTIVITIES[0];
    const found = findActivity(known.id);
    expect(found).toEqual(known);
  });

  it("returns undefined when the id is not in the library", () => {
    expect(findActivity("does-not-exist")).toBeUndefined();
  });

  it("only uses aerobic or anaerobic categories", () => {
    for (const activity of EXERCISE_ACTIVITIES) {
      expect(["aerobic", "anaerobic"]).toContain(activity.category);
    }
  });
});
