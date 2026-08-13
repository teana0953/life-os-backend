import { describe, expect, it } from "vitest";
import {
  type CareChainItemRepo,
  hasUpcomingCareDate,
  planCareChainDateOnOrAfter,
  planNextCareChainDate,
} from "../../../../src/contexts/notifications/application/care-day-chain";
import type { CareItemWithSchedules, CareSchedule } from "../../../../src/contexts/notifications/domain/care-item";

const USER = "user-1";
const WEDNESDAY = "2026-08-12";

function item(id: string, schedules: Partial<CareSchedule>[]): CareItemWithSchedules {
  return {
    id,
    userId: USER,
    category: "medication",
    title: "藥物",
    note: null,
    dose: null,
    stock: null,
    stockAlert: null,
    schedules: schedules.map((schedule, i) => ({
      id: `${id}-sched-${i}`,
      careItemId: id,
      timeOfDay: "09:00",
      repeatDays: [],
      weekInterval: 1,
      startDate: "2026-07-01",
      endDate: null,
      doseQuantity: 1,
      nagIntervalMinutes: 0,
      enabled: true,
      ...schedule,
    })),
  };
}

function repoOf(...items: CareItemWithSchedules[]): CareChainItemRepo {
  return { listByUser: async (userId) => (userId === USER ? items : []) };
}

describe("planNextCareChainDate", () => {
  it("considers every item's schedules together, returning the earliest next day", async () => {
    const repo = repoOf(item("item-a", [{ repeatDays: [1] }]), item("item-b", [{ repeatDays: [5] }]));
    expect(await planNextCareChainDate(repo, USER, WEDNESDAY)).toBe("2026-08-14"); // Friday beats Monday.
  });

  it("returns null when the user has no items at all", async () => {
    expect(await planNextCareChainDate(repoOf(), USER, WEDNESDAY)).toBeNull();
  });
});

describe("planCareChainDateOnOrAfter", () => {
  it("returns the anchor day ITSELF when it is a care day (the whole point of the shift)", async () => {
    const repo = repoOf(item("item-a", [{}])); // daily.
    // `planNextCareChainDate` scans strictly forward, so the plain version
    // would answer 2026-08-13 here. An overdue instance handed that value
    // would skip the rest of today entirely.
    expect(await planCareChainDateOnOrAfter(repo, USER, WEDNESDAY)).toBe(WEDNESDAY);
  });

  it("returns the next later care day when the anchor day itself is idle", async () => {
    const repo = repoOf(item("item-a", [{ repeatDays: [1] }])); // Mondays; WEDNESDAY is idle.
    expect(await planCareChainDateOnOrAfter(repo, USER, WEDNESDAY)).toBe("2026-08-17");
  });

  it("returns null once nothing is scheduled on or after the anchor day", async () => {
    const repo = repoOf(item("item-a", [{ endDate: "2026-08-11" }]));
    expect(await planCareChainDateOnOrAfter(repo, USER, WEDNESDAY)).toBeNull();
  });
});

describe("hasUpcomingCareDate", () => {
  it("counts TODAY as upcoming (a schedule active only today still keeps the instance)", async () => {
    // The whole point of the `previousLocalDate` shift: `nextCareChainDate`
    // scans strictly forward, so without it a user whose last care day is
    // today would be treated as having nothing left and lose today's
    // reminders.
    const repo = repoOf(item("item-a", [{ endDate: WEDNESDAY }]));
    expect(await hasUpcomingCareDate(repo, USER, WEDNESDAY)).toBe(true);
    // The day after that same schedule's end: genuinely nothing left.
    expect(await hasUpcomingCareDate(repo, USER, "2026-08-13")).toBe(false);
  });

  it("is true when today is idle but a later day is not", async () => {
    const repo = repoOf(item("item-a", [{ repeatDays: [1] }])); // Mondays; WEDNESDAY is idle.
    expect(await hasUpcomingCareDate(repo, USER, WEDNESDAY)).toBe(true);
  });
});
