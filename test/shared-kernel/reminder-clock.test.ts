import { describe, expect, it } from "vitest";
import {
  epochDayOf,
  localMinute,
  localParts,
  nextLocalDate,
  nextLocalMidnightInstant,
  previousLocalDate,
  utcInstantFor,
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

describe("epochDayOf", () => {
  it("is 0 at the epoch and counts whole calendar days from it", () => {
    expect(epochDayOf("1970-01-01")).toBe(0);
    expect(epochDayOf("1970-01-02")).toBe(1);
    expect(epochDayOf("1969-12-31")).toBe(-1);
  });

  it("advances by exactly 1 per calendar day across month and year boundaries", () => {
    // The property `nextCareChainDate`'s checkpoint grid rests on: any N
    // consecutive days contain exactly one multiple of N.
    let date = "2026-12-20";
    for (let i = 0; i < 30; i++) {
      const next = nextLocalDate(date);
      expect(epochDayOf(next) - epochDayOf(date)).toBe(1);
      date = next;
    }
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

describe("utcInstantFor", () => {
  it("resolves an ordinary Asia/Taipei (UTC+8, no DST) time by simple offset subtraction", () => {
    // 09:00 local - 8h -> 01:00Z.
    expect(utcInstantFor("2026-07-24", "09:00", "Asia/Taipei")).toEqual(new Date("2026-07-24T01:00:00Z"));
  });

  it("round-trips with localParts for an ordinary America/New_York (UTC-4, DST) time", () => {
    const instant = utcInstantFor("2026-07-24", "09:00", "America/New_York");
    expect(instant).toEqual(new Date("2026-07-24T13:00:00Z"));
    expect(localParts(instant, "America/New_York")).toEqual({ date: "2026-07-24", hhmm: "09:00", weekday: 5 });
  });

  // 2026-03-08 is the US spring-forward date: clocks jump from 02:00 EST
  // straight to 03:00 EDT, so 02:30 never occurs (D1' in
  // replace-cron-with-workflows/design.md — take the first legal instant
  // after the gap, i.e. 03:00 EDT = 07:00Z).
  it("spring-forward gap: a non-existent local time resolves to the first instant after the gap", () => {
    const instant = utcInstantFor("2026-03-08", "02:30", "America/New_York");
    expect(instant).toEqual(new Date("2026-03-08T07:00:00Z"));
  });

  it("spring-forward gap: an ordinary time on the same day, safely on either side of the transition, is unaffected", () => {
    expect(utcInstantFor("2026-03-08", "01:00", "America/New_York")).toEqual(new Date("2026-03-08T06:00:00Z")); // still EST
    expect(utcInstantFor("2026-03-08", "03:30", "America/New_York")).toEqual(new Date("2026-03-08T07:30:00Z")); // already EDT
  });

  // 2026-11-01 is the US fall-back date: clocks fall from 02:00 EDT back to
  // 01:00 EST, so 01:30 occurs twice — once at 01:30 EDT (05:30Z) and once at
  // 01:30 EST (06:30Z). Take the first occurrence (D1').
  it("fall-back overlap: a doubled local time resolves to its first (earlier) occurrence", () => {
    const instant = utcInstantFor("2026-11-01", "01:30", "America/New_York");
    expect(instant).toEqual(new Date("2026-11-01T05:30:00Z"));
  });

  it("fall-back overlap: an ordinary time on the same day, safely on either side of the transition, is unaffected", () => {
    expect(utcInstantFor("2026-11-01", "00:30", "America/New_York")).toEqual(new Date("2026-11-01T04:30:00Z")); // still EDT
    expect(utcInstantFor("2026-11-01", "03:00", "America/New_York")).toEqual(new Date("2026-11-01T08:00:00Z")); // already EST
  });
});

describe("nextLocalMidnightInstant", () => {
  it("returns the UTC instant of the next local midnight in Asia/Taipei", () => {
    // 2026-07-24 18:15 Taipei -> next local midnight is 2026-07-25 00:00 Taipei = 2026-07-24T16:00:00Z.
    const result = nextLocalMidnightInstant(new Date("2026-07-24T10:15:00Z"), "Asia/Taipei");
    expect(result).toEqual(new Date("2026-07-24T16:00:00Z"));
  });

  it("returns the UTC instant of the next local midnight across a DST transition", () => {
    // 2026-03-08 10:00 EST (2026-03-08T15:00:00Z) -> next local midnight is
    // 2026-03-09 00:00 EDT (offset already -4h by then) = 2026-03-09T04:00:00Z.
    const result = nextLocalMidnightInstant(new Date("2026-03-08T15:00:00Z"), "America/New_York");
    expect(result).toEqual(new Date("2026-03-09T04:00:00Z"));
  });
});
