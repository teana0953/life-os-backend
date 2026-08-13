import { describe, expect, it } from "vitest";
import { ensureCareDayInstances } from "../../../../src/contexts/notifications/application/ensure-care-day-instances";
import type { CareDayInstanceManager } from "../../../../src/contexts/notifications/domain/care-day-instance";
import type { ActiveCareSchedule, CareItem, CareItemRepository, CareSchedule } from "../../../../src/contexts/notifications/domain/care-item";

const TAIPEI = "Asia/Taipei";
/** 2026-08-12T09:00 Taipei — a Wednesday. */
const NOW = new Date("2026-08-12T01:00:00Z");

function activeRow(userId: string, schedule: Partial<CareSchedule>, timezone = TAIPEI): ActiveCareSchedule {
  const item: CareItem = {
    id: `${userId}-item`,
    userId,
    category: "medication",
    title: "藥物",
    note: null,
    dose: null,
    stock: null,
    stockAlert: null,
  };
  return {
    item,
    timezone,
    schedule: {
      id: `${userId}-sched-${schedule.repeatDays?.join("") ?? "d"}-${schedule.startDate ?? ""}`,
      careItemId: item.id,
      timeOfDay: "09:00",
      repeatDays: [],
      weekInterval: 1,
      startDate: "2026-07-01",
      endDate: null,
      doseQuantity: 1,
      nagIntervalMinutes: 0,
      enabled: true,
      ...schedule,
    },
  };
}

function buildDeps(rows: ActiveCareSchedule[]) {
  const ensured: { userId: string; localDate: string }[] = [];
  const careItemRepo = {
    listActiveSchedules: async () => rows,
  } as unknown as CareItemRepository;
  const instanceManager: CareDayInstanceManager = {
    ensureFor: async (userId, localDate) => {
      ensured.push({ userId, localDate });
    },
    restartToday: async () => {
      throw new Error("the cron must never call restartToday");
    },
  };
  return { ensured, deps: { careItemRepo, instanceManager } };
}

describe("ensureCareDayInstances", () => {
  it("ensures TODAY's instance for a user whose schedule fires today", async () => {
    const { ensured, deps } = buildDeps([activeRow("user-1", {})]);

    await ensureCareDayInstances(NOW, deps);

    expect(ensured).toEqual([{ userId: "user-1", localDate: "2026-08-12" }]);
  });

  it("ensures the NEXT MONDAY's instance for a Mondays-only user asked on a Wednesday", async () => {
    const { ensured, deps } = buildDeps([activeRow("user-1", { repeatDays: [1] })]);

    await ensureCareDayInstances(NOW, deps);

    // Load-bearing as an equality: the pre-fix cron created a today instance
    // for this user every single day, each one waking only to find nothing.
    expect(ensured).toEqual([{ userId: "user-1", localDate: "2026-08-17" }]);
  });

  it("creates nothing for a user whose schedules are all enabled but expired", async () => {
    const { ensured, deps } = buildDeps([activeRow("user-1", { endDate: "2026-08-01" })]);

    await ensureCareDayInstances(NOW, deps);

    expect(ensured).toEqual([]);
  });

  it("takes the earliest day across a user's several schedules, and keeps users independent", async () => {
    const { ensured, deps } = buildDeps([
      activeRow("user-1", { repeatDays: [1] }), // next Monday, 2026-08-17
      activeRow("user-1", { repeatDays: [5] }), // this Friday, 2026-08-14
      activeRow("user-2", {}), // daily → today
    ]);

    await ensureCareDayInstances(NOW, deps);

    expect(ensured).toEqual([
      { userId: "user-1", localDate: "2026-08-14" },
      { userId: "user-2", localDate: "2026-08-12" },
    ]);
  });

  it("one user's failure does not stop the others", async () => {
    const ensured: string[] = [];
    const careItemRepo = {
      listActiveSchedules: async () => [activeRow("user-1", {}), activeRow("user-2", {})],
    } as unknown as CareItemRepository;
    const instanceManager: CareDayInstanceManager = {
      ensureFor: async (userId) => {
        if (userId === "user-1") throw new Error("workflows down");
        ensured.push(userId);
      },
      restartToday: async () => {},
    };

    await expect(ensureCareDayInstances(NOW, { careItemRepo, instanceManager })).resolves.toBeUndefined();
    expect(ensured).toEqual(["user-2"]);
  });

  it("BLOCKER: a dormant user gets the SAME target day on 20 consecutive cron runs, not a fresh instance each day", async () => {
    // The one schedule here can only fire far beyond the scan horizon, so the
    // cron takes the checkpoint branch every day. If the checkpoint were
    // anchor-relative (`today - 1 + horizon`), each run would name a different
    // day → a different deterministic id → `ensureFor` never collides and this
    // user accumulates one idle sleeper per day against the free plan's
    // 100-concurrent ceiling. Exactly the runaway idle chain this change fixes.
    const dormant = activeRow("user-1", { repeatDays: [1], weekInterval: 60, startDate: "2026-08-03" });
    const targets = new Set<string>();
    for (let day = 0; day < 20; day++) {
      const { ensured, deps } = buildDeps([dormant]);
      await ensureCareDayInstances(new Date(NOW.getTime() + day * 24 * 60 * 60 * 1000), deps);
      expect(ensured).toHaveLength(1);
      targets.add(ensured[0].localDate);
    }
    expect([...targets]).toEqual(["2026-09-04"]);
  });

  it("resolves each user's day in that user's own timezone", async () => {
    // 2026-08-12T01:00Z is still 2026-08-11 in New York.
    const { ensured, deps } = buildDeps([activeRow("user-1", {}, "America/New_York")]);

    await ensureCareDayInstances(NOW, deps);

    expect(ensured).toEqual([{ userId: "user-1", localDate: "2026-08-11" }]);
  });
});
