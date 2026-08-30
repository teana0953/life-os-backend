import { describe, expect, it } from "vitest";
import {
  FREE_PLAN_SUBREQUEST_LIMIT,
  recordSubrequest,
  remainingSubrequestBudget,
  withSubrequestBudget,
} from "../../../src/shared/db/subrequest-budget";

/**
 * `remainingSubrequestBudget` is what the care dispatch loop compares a
 * slot's worst case against before claiming it
 * (fix-care-reminder-subrequest-n-plus-1 design.md D4). `null` outside a
 * scope is load-bearing: every existing caller (all the single-query HTTP
 * routes, and every test that never opens a scope) must keep behaving as
 * unlimited, so the budget brake can only ever engage where a scope was
 * deliberately established.
 */
describe("remainingSubrequestBudget", () => {
  it("is null outside any budget scope, so unscoped callers stay unlimited", () => {
    expect(remainingSubrequestBudget()).toBeNull();
  });

  it("starts at the full limit inside a scope and decreases with each recorded subrequest", async () => {
    await withSubrequestBudget(10, async () => {
      expect(remainingSubrequestBudget()).toBe(10);
      recordSubrequest();
      expect(remainingSubrequestBudget()).toBe(9);
      recordSubrequest();
      recordSubrequest();
      expect(remainingSubrequestBudget()).toBe(7);
    });
  });

  it("does not go negative once more subrequests are recorded than the limit allows", async () => {
    await withSubrequestBudget(2, async () => {
      recordSubrequest();
      recordSubrequest();
      recordSubrequest();
      expect(remainingSubrequestBudget()).toBe(0);
    });
  });

  it("is null again after the scope ends", async () => {
    await withSubrequestBudget(10, async () => {
      expect(remainingSubrequestBudget()).toBe(10);
    });
    expect(remainingSubrequestBudget()).toBeNull();
  });

  it("gives each scope its own budget: one scope's consumption does not shrink the next", async () => {
    await withSubrequestBudget(FREE_PLAN_SUBREQUEST_LIMIT, async () => {
      recordSubrequest();
      recordSubrequest();
    });
    await withSubrequestBudget(FREE_PLAN_SUBREQUEST_LIMIT, async () => {
      expect(remainingSubrequestBudget()).toBe(FREE_PLAN_SUBREQUEST_LIMIT);
    });
  });

  it("keeps FREE_PLAN_SUBREQUEST_LIMIT at the Workers Free plan's documented ceiling", () => {
    expect(FREE_PLAN_SUBREQUEST_LIMIT).toBe(50);
  });
});
