import { afterEach, describe, expect, it } from "vitest";
import { CHAODAYS_BATCH_DAYS, splitDateRange } from "../../../../src/contexts/health/domain/date-range-batches";

/** Inclusive day count of `[from, to]`, computed in UTC (independent of the implementation). */
function inclusiveDays(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000 + 1;
}

/** The day after `day`, computed in UTC. */
function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

describe("splitDateRange", () => {
  it("uses a batch size of 183 days", () => {
    expect(CHAODAYS_BATCH_DAYS).toBe(183);
  });

  it("returns a single batch for a single day", () => {
    expect(splitDateRange("2026-07-01", "2026-07-01")).toEqual([{ from: "2026-07-01", to: "2026-07-01" }]);
  });

  it("returns a single batch for a range exactly the batch size", () => {
    // 2026-01-01 .. 2026-07-02 is exactly 183 days inclusive.
    expect(inclusiveDays("2026-01-01", "2026-07-02")).toBe(CHAODAYS_BATCH_DAYS);
    expect(splitDateRange("2026-01-01", "2026-07-02")).toEqual([{ from: "2026-01-01", to: "2026-07-02" }]);
  });

  it("splits a range one day longer than the batch size into two seamless batches", () => {
    expect(splitDateRange("2026-01-01", "2026-07-03")).toEqual([
      { from: "2026-01-01", to: "2026-07-02" },
      { from: "2026-07-03", to: "2026-07-03" },
    ]);
  });

  it("starts each batch on the day after the previous batch ended, with no gap and no overlap", () => {
    const batches = splitDateRange("2026-01-01", "2028-12-31");

    expect(batches.length).toBeGreaterThan(1);
    expect(batches[0].from).toBe("2026-01-01");
    expect(batches[batches.length - 1].to).toBe("2028-12-31");
    for (const batch of batches) {
      expect(inclusiveDays(batch.from, batch.to)).toBeLessThanOrEqual(CHAODAYS_BATCH_DAYS);
      expect(inclusiveDays(batch.from, batch.to)).toBeGreaterThan(0);
    }
    for (let i = 1; i < batches.length; i++) {
      expect(batches[i].from).toBe(nextDay(batches[i - 1].to));
    }
    // Together the batches cover exactly the requested range.
    const covered = batches.reduce((sum, batch) => sum + inclusiveDays(batch.from, batch.to), 0);
    expect(covered).toBe(inclusiveDays("2026-01-01", "2028-12-31"));
  });

  it("counts the leap day when a batch crosses one", () => {
    // 2028 is a leap year: 2027-10-01 + 182 days lands on 2028-03-31 only if
    // 2028-02-29 is counted.
    expect(splitDateRange("2027-10-01", "2028-06-30")).toEqual([
      { from: "2027-10-01", to: "2028-03-31" },
      { from: "2028-04-01", to: "2028-06-30" },
    ]);
  });

  it("splits a range that crosses a year boundary", () => {
    expect(splitDateRange("2026-09-01", "2027-06-30")).toEqual([
      { from: "2026-09-01", to: "2027-03-02" },
      { from: "2027-03-03", to: "2027-06-30" },
    ]);
  });

  describe("anchored to UTC", () => {
    const originalTz = process.env.TZ;

    afterEach(() => {
      // Assigning back an undefined original would set the string "undefined",
      // which is not a valid zone — Node then falls back to UTC. Vitest isolates
      // per file so nothing downstream is affected today, but that only holds
      // while this stays the last block in the file. Most machines and CI
      // runners do not export TZ, so this branch is the normal path.
      if (originalTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTz;
      }
    });

    it("produces the same batches in a non-UTC timezone that crosses DST", () => {
      process.env.TZ = "UTC";
      const inUtc = splitDateRange("2026-01-01", "2028-12-31");

      // East of UTC on purpose: local-Date arithmetic there rolls a local
      // midnight back to the previous UTC day, which is the regression this
      // guards. West of UTC (e.g. America/New_York) it would stay on the same
      // day and the comparison would agree even with the bug.
      process.env.TZ = "Europe/Berlin";
      const inBerlin = splitDateRange("2026-01-01", "2028-12-31");

      expect(inBerlin).toEqual(inUtc);
      // Pinned so the assertion still bites if both timezones drift together.
      expect(inBerlin[0]).toEqual({ from: "2026-01-01", to: "2026-07-02" });
    });
  });
});
