import { describe, expect, it } from "vitest";
import type { CareSchedule } from "../../../../src/contexts/notifications/domain/care-item";
import { CARE_CHAIN_HORIZON_DAYS, nextCareChainDate } from "../../../../src/contexts/notifications/domain/care-schedule";
import { epochDayOf, nextLocalDate, previousLocalDate } from "../../../../src/shared-kernel/reminder-clock";

/** A daily, always-on schedule, overridden per case. */
function schedule(overrides: Partial<CareSchedule> = {}): CareSchedule {
  return {
    id: "sched-1",
    careItemId: "item-1",
    timeOfDay: "09:00",
    repeatDays: [],
    weekInterval: 1,
    startDate: "2026-07-01",
    endDate: null,
    doseQuantity: 1,
    nagIntervalMinutes: 0,
    enabled: true,
    ...overrides,
  };
}

/** `n` days after `date`, by the same calendar arithmetic the scan itself uses. */
function plusDays(date: string, n: number): string {
  let result = date;
  for (let i = 0; i < n; i++) result = nextLocalDate(result);
  return result;
}

const WEDNESDAY = "2026-08-12";

describe("nextCareChainDate", () => {
  it("an every-day schedule returns tomorrow", () => {
    expect(nextCareChainDate([schedule()], WEDNESDAY)).toBe("2026-08-13");
  });

  it("never returns `afterLocalDate` itself, even when that day is active", () => {
    // The scan is strictly forward: an instance asking "what comes after the
    // day I just finished" must never be handed its own day back — that would
    // spawn an instance for a day that has already ended, forever.
    expect(nextCareChainDate([schedule()], WEDNESDAY)).not.toBe(WEDNESDAY);
  });

  it("a Mondays-only schedule skips straight to the next Monday, not to tomorrow", () => {
    expect(nextCareChainDate([schedule({ repeatDays: [1] })], WEDNESDAY)).toBe("2026-08-17");
  });

  it("an every-2-weeks schedule skips the off week, anchored on startDate", () => {
    // startDate 2026-08-03 is a Monday: on-weeks are 08-03, 08-17, 08-31.
    const every2 = schedule({ repeatDays: [1], weekInterval: 2, startDate: "2026-08-03" });
    expect(nextCareChainDate([every2], "2026-08-03")).toBe("2026-08-17"); // 08-10 is the off week.
    expect(nextCareChainDate([every2], "2026-08-17")).toBe("2026-08-31");
  });

  it("a schedule that starts in the future returns its first active day", () => {
    expect(nextCareChainDate([schedule({ startDate: "2026-09-01" })], WEDNESDAY)).toBe("2026-09-01");
  });

  it("returns null once every schedule's endDate has passed", () => {
    expect(nextCareChainDate([schedule({ endDate: "2026-08-12" })], WEDNESDAY)).toBeNull();
  });

  it("ignores disabled schedules entirely", () => {
    expect(nextCareChainDate([schedule({ enabled: false })], WEDNESDAY)).toBeNull();
    // Reverse: the same schedule enabled DOES produce a day — so the null
    // above is the `enabled` filter, not a broken scan.
    expect(nextCareChainDate([schedule({ enabled: true })], WEDNESDAY)).toBe("2026-08-13");
  });

  it("returns the earliest day across several schedules", () => {
    const monday = schedule({ id: "a", repeatDays: [1] }); // 2026-08-17
    const friday = schedule({ id: "b", repeatDays: [5] }); // 2026-08-14
    expect(nextCareChainDate([monday, friday], WEDNESDAY)).toBe("2026-08-14");
  });

  it("beyond the horizon: an open-ended long-interval schedule returns a grid checkpoint inside the scanned window", () => {
    // Every 60 weeks — far past a 90-day scan. Rather than give up (which
    // would silently end a live chain), the scan hands back a checkpoint day;
    // the instance that wakes there re-scans from its own day.
    const rare = schedule({ repeatDays: [1], weekInterval: 60, startDate: "2026-08-03" });
    const checkpoint = nextCareChainDate([rare], WEDNESDAY);
    expect(checkpoint).not.toBeNull();
    // On the global grid, and inside the window actually scanned — so
    // re-scanning from it covers everything this call skipped.
    expect(epochDayOf(checkpoint as string) % CARE_CHAIN_HORIZON_DAYS).toBe(0);
    expect(checkpoint as string).toBe("2026-09-04");
    expect(checkpoint as string > WEDNESDAY).toBe(true);
    expect(checkpoint as string <= plusDays(WEDNESDAY, CARE_CHAIN_HORIZON_DAYS)).toBe(true);
  });

  it("BLOCKER: the checkpoint is a function of the calendar, not of the anchor — 90 consecutive anchors give at most 2 distinct answers", () => {
    // The cron re-anchors every day (`previousLocalDate(today)`). If the
    // checkpoint were `anchor + horizon`, each day would name a different,
    // never-colliding instance id and a dormant user would accumulate ~90
    // idle sleepers against the free plan's 100-concurrent ceiling. With a
    // global grid, a whole horizon's worth of consecutive anchors collapses
    // onto the ONE grid day they share (two only across the grid boundary
    // itself, where the older instance is the one running that very day).
    const rare = schedule({ repeatDays: [1], weekInterval: 60, startDate: "2026-08-03" });
    const answers = new Set<string | null>();
    let anchor = WEDNESDAY;
    for (let i = 0; i < CARE_CHAIN_HORIZON_DAYS; i++) {
      answers.add(nextCareChainDate([rare], anchor));
      anchor = nextLocalDate(anchor);
    }
    expect(answers.size).toBeLessThanOrEqual(2);
  });

  it("BLOCKER: cron and chain agree — the day a checkpoint instance runs, the cron re-derives that same day, then follows the chain's own successor", () => {
    // Cron's anchor is `previousLocalDate(today)`; the chain's anchor is the
    // day the instance itself owns. These must never name two different days
    // at once, or two live instances exist per user forever.
    const rare = schedule({ repeatDays: [1], weekInterval: 60, startDate: "2026-08-03" });
    const checkpoint = nextCareChainDate([rare], WEDNESDAY) as string;

    // Cron running ON the checkpoint day re-derives the checkpoint itself →
    // `ensureFor` collides with the already-running instance and no-ops.
    expect(nextCareChainDate([rare], previousLocalDate(checkpoint))).toBe(checkpoint);

    // The chain's own successor, and every cron run after the checkpoint day,
    // agree on the next grid day.
    const successor = nextCareChainDate([rare], checkpoint) as string;
    expect(successor).toBe(plusDays(checkpoint, CARE_CHAIN_HORIZON_DAYS));
    for (let i = 1; i <= CARE_CHAIN_HORIZON_DAYS; i++) {
      expect(nextCareChainDate([rare], previousLocalDate(plusDays(checkpoint, i)))).toBe(successor);
    }
  });

  it("BLOCKER: two chains started from unrelated days converge on their very next checkpoint", () => {
    // design.md W1'/(f) claim any two transiently-coexisting chains merge by
    // colliding on a deterministic id. With anchor-relative checkpoints their
    // date sequences could stay disjoint forever (c1+90k vs c2+90k); on the
    // grid they meet at the first grid day after the later of the two.
    const rare = schedule({ repeatDays: [1], weekInterval: 60, startDate: "2026-08-03" });
    const chainA = nextCareChainDate([rare], "2026-08-12") as string;
    const chainB = nextCareChainDate([rare], "2026-08-30") as string;
    expect(chainA).toBe(chainB);
  });

  it("beyond the horizon: nothing is returned when the schedule also ends inside the horizon", () => {
    // Same long interval, but it expires before it could ever fire again —
    // the checkpoint must NOT keep the chain alive here.
    const rare = schedule({ repeatDays: [1], weekInterval: 60, startDate: "2026-08-03", endDate: plusDays(WEDNESDAY, 30) });
    expect(nextCareChainDate([rare], WEDNESDAY)).toBeNull();
  });
});
