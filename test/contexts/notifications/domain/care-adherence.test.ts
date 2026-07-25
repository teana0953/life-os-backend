import { describe, expect, it } from "vitest";
import { buildCareAdherenceSeries } from "../../../../src/contexts/notifications/domain/care-adherence";
import type { CareSchedule } from "../../../../src/contexts/notifications/domain/care-item";
import type { CareLog } from "../../../../src/contexts/notifications/domain/care-log";

function makeSchedule(overrides: Partial<CareSchedule> = {}): CareSchedule {
  return {
    id: "sched-1",
    careItemId: "item-1",
    timeOfDay: "08:00",
    repeatDays: [],
    weekInterval: 1,
    startDate: "2020-01-01",
    endDate: null,
    doseQuantity: 1,
    nagIntervalMinutes: 15,
    enabled: true,
    ...overrides,
  };
}

function makeLog(overrides: Partial<CareLog> = {}): CareLog {
  return {
    id: "log-1",
    userId: "user-1",
    careItemId: "item-1",
    careScheduleId: "sched-1",
    localDate: "2026-07-20",
    timeOfDay: "08:00",
    status: "done",
    doneTime: new Date("2026-07-20T00:00:00Z"),
    doseQuantity: 1,
    ...overrides,
  };
}

describe("buildCareAdherenceSeries", () => {
  it("covers every day in [from, to] inclusive, including boundary days", () => {
    const result = buildCareAdherenceSeries([], [], "2026-07-20", "2026-07-22");

    expect(result).toEqual({
      from: "2026-07-20",
      to: "2026-07-22",
      days: [
        { date: "2026-07-20", scheduled: 0, done: 0, skipped: 0, missed: 0 },
        { date: "2026-07-21", scheduled: 0, done: 0, skipped: 0, missed: 0 },
        { date: "2026-07-22", scheduled: 0, done: 0, skipped: 0, missed: 0 },
      ],
    });
  });

  it("counts an every-day schedule (empty repeat_days) as scheduled=1 on each day", () => {
    const schedule = makeSchedule({ repeatDays: [] });

    const result = buildCareAdherenceSeries([schedule], [], "2026-07-20", "2026-07-21");

    expect(result.days.map((d) => d.scheduled)).toEqual([1, 1]);
  });

  it("scheduled respects weekday selection (reuses isActiveOn)", () => {
    // 2026-07-20 is a Monday (weekday 1); 2026-07-21 is a Tuesday (weekday 2).
    const schedule = makeSchedule({ repeatDays: [1] });

    const result = buildCareAdherenceSeries([schedule], [], "2026-07-20", "2026-07-21");

    expect(result.days.map((d) => d.scheduled)).toEqual([1, 0]);
  });

  it("scheduled respects the start/end date range", () => {
    const schedule = makeSchedule({ startDate: "2026-07-21", endDate: "2026-07-21" });

    const result = buildCareAdherenceSeries([schedule], [], "2026-07-20", "2026-07-22");

    expect(result.days.map((d) => d.scheduled)).toEqual([0, 1, 0]);
  });

  it("scheduled respects the every-N-weeks interval", () => {
    // startDate 2026-07-06 (Monday); weekInterval 2 -> active on weeks 0, 2, ...
    const schedule = makeSchedule({ startDate: "2026-07-06", weekInterval: 2, repeatDays: [1] });

    const result = buildCareAdherenceSeries([schedule], [], "2026-07-06", "2026-07-20");
    const byDate = Object.fromEntries(result.days.map((d) => [d.date, d.scheduled]));

    expect(byDate["2026-07-06"]).toBe(1); // week 0
    expect(byDate["2026-07-13"]).toBe(0); // week 1, off
    expect(byDate["2026-07-20"]).toBe(1); // week 2
  });

  it("a disabled schedule is NOT counted in scheduled (isActiveOn alone does not check enabled)", () => {
    const schedule = makeSchedule({ enabled: false });

    const result = buildCareAdherenceSeries([schedule], [], "2026-07-20", "2026-07-20");

    expect(result.days[0].scheduled).toBe(0);
  });

  it("done/skipped/missed reflect that day's logs by status", () => {
    const logs = [
      makeLog({ id: "l1", localDate: "2026-07-20", status: "done" }),
      makeLog({ id: "l2", localDate: "2026-07-20", status: "skipped" }),
      makeLog({ id: "l3", localDate: "2026-07-20", status: "missed" }),
    ];

    const result = buildCareAdherenceSeries([], logs, "2026-07-20", "2026-07-20");

    expect(result.days[0]).toMatchObject({ done: 1, skipped: 1, missed: 1 });
  });

  it("done+skipped+missed may be less than scheduled (pending, unanswered so far)", () => {
    const schedule1 = makeSchedule({ id: "sched-1" });
    const schedule2 = makeSchedule({ id: "sched-2" });
    const logs = [makeLog({ localDate: "2026-07-20", careScheduleId: "sched-1", status: "done" })];

    const result = buildCareAdherenceSeries([schedule1, schedule2], logs, "2026-07-20", "2026-07-20");

    expect(result.days[0]).toMatchObject({ scheduled: 2, done: 1, skipped: 0, missed: 0 });
  });

  it("an empty day (no active schedule) has scheduled=0", () => {
    const schedule = makeSchedule({ repeatDays: [1] }); // only Monday

    // 2026-07-21 is a Tuesday.
    const result = buildCareAdherenceSeries([schedule], [], "2026-07-21", "2026-07-21");

    expect(result.days[0]).toEqual({ date: "2026-07-21", scheduled: 0, done: 0, skipped: 0, missed: 0 });
  });

  it("expands schedules and logs across each day of a multi-day range independently", () => {
    const schedule = makeSchedule();
    const logs = [makeLog({ localDate: "2026-07-21", status: "done" })];

    const result = buildCareAdherenceSeries([schedule], logs, "2026-07-20", "2026-07-22");

    expect(result.days).toEqual([
      { date: "2026-07-20", scheduled: 1, done: 0, skipped: 0, missed: 0 },
      { date: "2026-07-21", scheduled: 1, done: 1, skipped: 0, missed: 0 },
      { date: "2026-07-22", scheduled: 1, done: 0, skipped: 0, missed: 0 },
    ]);
  });
});
