import { describe, expect, it } from "vitest";
import { periodsOverlap } from "../../../../src/contexts/health/domain/menstrual-period";

function span(startDate: string, endDate: string | null) {
  return { startDate, endDate };
}

/** Asserts the answer is the same whichever way round the two spans are given. */
function expectSymmetric(a: { startDate: string; endDate: string | null }, b: typeof a, expected: boolean) {
  expect(periodsOverlap(a, b)).toBe(expected);
  expect(periodsOverlap(b, a)).toBe(expected);
}

describe("periodsOverlap", () => {
  it("treats identical closed spans as overlapping", () => {
    expectSymmetric(span("2026-05-01", "2026-05-05"), span("2026-05-01", "2026-05-05"), true);
  });

  it("treats a partial overlap as overlapping, from either side", () => {
    // b starts inside a
    expectSymmetric(span("2026-05-01", "2026-05-05"), span("2026-05-04", "2026-05-08"), true);
    // b starts before a and ends inside it
    expectSymmetric(span("2026-05-04", "2026-05-08"), span("2026-05-01", "2026-05-05"), true);
  });

  it("treats containment as overlapping", () => {
    expectSymmetric(span("2026-05-01", "2026-05-10"), span("2026-05-03", "2026-05-04"), true);
  });

  it("treats a one-day offset of the same real period as overlapping", () => {
    expectSymmetric(span("2026-05-01", "2026-05-05"), span("2026-05-02", "2026-05-06"), true);
  });

  it("does not treat adjacent spans as overlapping", () => {
    expectSymmetric(span("2026-05-01", "2026-05-05"), span("2026-05-06", "2026-05-10"), false);
  });

  it("does not treat separated spans as overlapping", () => {
    expectSymmetric(span("2026-05-01", "2026-05-05"), span("2026-06-01", "2026-06-05"), false);
  });

  it("treats spans sharing a single day as overlapping", () => {
    // The boundary the closed-interval reading turns on: one ends the day the
    // other starts. Off by one here and every day-apart duplicate slips through.
    expectSymmetric(span("2026-05-01", "2026-05-05"), span("2026-05-05", "2026-05-09"), true);
  });

  it("treats an open-ended span as reaching indefinitely forward", () => {
    expectSymmetric(span("2026-05-10", null), span("2026-06-01", "2026-06-05"), true);
    expectSymmetric(span("2026-05-10", null), span("2026-05-10", "2026-05-14"), true);
  });

  it("treats a span starting before an open-ended one as overlapping when their days meet", () => {
    // The day-apart case, in the direction a one-sided "later than" rule misses.
    expectSymmetric(span("2026-05-10", null), span("2026-05-09", "2026-05-14"), true);
  });

  it("does not treat a span ending before an open-ended one starts as overlapping", () => {
    expectSymmetric(span("2026-05-10", null), span("2026-05-01", "2026-05-09"), false);
  });

  it("treats two open-ended spans as overlapping", () => {
    expectSymmetric(span("2026-05-10", null), span("2026-01-01", null), true);
  });
});
