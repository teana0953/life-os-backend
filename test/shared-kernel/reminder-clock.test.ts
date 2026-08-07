import { describe, expect, it } from "vitest";
import {
  localMinute,
  localParts,
  nextLocalDate,
  previousLocalDate,
  weekdayOf,
  weeksSince,
} from "../../src/shared-kernel/reminder-clock";

describe("localParts", () => {
  it("resolves date/hhmm/weekday for a UTC instant in Asia/Taipei (UTC+8, no DST)", () => {
    // 2026-07-24T10:15:00Z + 8h -> 2026-07-24 18:15 local, a Friday.
    const result = localParts(new Date("2026-07-24T10:15:00Z"), "Asia/Taipei");

    expect(result).toEqual({ date: "2026-07-24", hhmm: "18:15", weekday: 5 });
  });

  it("resolves date/hhmm/weekday for a UTC instant in America/New_York (UTC-4 in July, DST), crossing the local day boundary", () => {
    // 2026-07-24T03:30:00Z - 4h -> 2026-07-23 23:30 local, a Thursday: the local
    // date and weekday differ from the UTC date, exercising real tz reasoning
    // (not just a fixed offset).
    const result = localParts(new Date("2026-07-24T03:30:00Z"), "America/New_York");

    expect(result).toEqual({ date: "2026-07-23", hhmm: "23:30", weekday: 4 });
  });

  it("resolves midnight as 00:mm, not 24:mm", () => {
    // 2026-01-15T05:00:00Z - 5h (EST, UTC-5 in January) -> 2026-01-15 00:00 local.
    const result = localParts(new Date("2026-01-15T05:00:00Z"), "America/New_York");

    expect(result).toEqual({ date: "2026-01-15", hhmm: "00:00", weekday: 4 });
  });
});

describe("weeksSince", () => {
  it("is 0 on the anchor date itself", () => {
    expect(weeksSince("2026-07-01", "2026-07-01")).toBe(0);
  });

  it("is 1 exactly one week (7 days) after the anchor", () => {
    expect(weeksSince("2026-07-01", "2026-07-08")).toBe(1);
  });

  it("floors a partial week (13 days after the anchor is still week 1)", () => {
    expect(weeksSince("2026-07-01", "2026-07-14")).toBe(1);
  });

  it("rolls over to the next whole week at exactly 14 days", () => {
    expect(weeksSince("2026-07-01", "2026-07-15")).toBe(2);
  });

  it("is negative when the anchor date is in the future relative to localDate", () => {
    expect(weeksSince("2026-07-10", "2026-07-01")).toBeLessThan(0);
  });
});

describe("weekdayOf", () => {
  it("returns the weekday of an arbitrary YYYY-MM-DD (locale/DST independent)", () => {
    expect(weekdayOf("2026-07-24")).toBe(5); // Friday
    expect(weekdayOf("2026-07-23")).toBe(4); // Thursday
  });
});

describe("previousLocalDate", () => {
  it("returns the calendar day before, including across a month boundary", () => {
    expect(previousLocalDate("2026-07-24")).toBe("2026-07-23");
    expect(previousLocalDate("2026-08-01")).toBe("2026-07-31");
    expect(previousLocalDate("2026-01-01")).toBe("2025-12-31");
  });
});

describe("nextLocalDate", () => {
  it("returns the calendar day after, including across a month boundary", () => {
    expect(nextLocalDate("2026-07-23")).toBe("2026-07-24");
    expect(nextLocalDate("2026-07-31")).toBe("2026-08-01");
    expect(nextLocalDate("2025-12-31")).toBe("2026-01-01");
  });
});

describe("localMinute", () => {
  it("orders minutes monotonically across a midnight rollover (23:59 the day before < 00:02 the next day)", () => {
    const late = localMinute("2026-07-24", "23:59");
    const early = localMinute("2026-07-25", "00:02");

    expect(early - late).toBe(3);
  });

  it("is the same instant for the same date+time", () => {
    expect(localMinute("2026-07-24", "09:00")).toBe(localMinute("2026-07-24", "09:00"));
  });
});
