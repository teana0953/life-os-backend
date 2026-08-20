import { afterEach, describe, expect, it, vi } from "vitest";
import { monthOf, section, SECTION_TIMEOUT_MS, windowEndingAt } from "../../../src/adapters/http/routes/screen-sections";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("section()", () => {
  it("wraps a resolved value in an ok envelope", async () => {
    expect(await section(async () => ({ total_ml: 750 }))).toEqual({ ok: true, data: { total_ml: 750 } });
  });

  it("resolves (never rejects) to an unavailable envelope when the thunk rejects", async () => {
    const envelope = await section(async () => {
      throw new Error("boom");
    });

    expect(envelope).toEqual({ ok: false, error: "unavailable" });
  });

  it("resolves to an unavailable envelope when the thunk throws synchronously", async () => {
    expect(
      await section(() => {
        throw new Error("boom");
      }),
    ).toEqual({ ok: false, error: "unavailable" });
  });

  // The envelope is what reaches the client: a driver message naming a host or
  // a stack trace must not ride out inside it (spec: "carries no internal detail").
  it("keeps the failure's message text out of the envelope", async () => {
    const secret = "postgres://user:hunter2@db.internal:5432/life";
    const envelope = await section(async () => {
      throw new Error(secret);
    });

    expect(JSON.stringify(envelope)).not.toContain(secret);
    expect(JSON.stringify(envelope)).not.toContain("hunter2");
  });

  it("logs a failed section through the internal-error path, and does not log a successful one", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await section(async () => "fine");
    expect(errorSpy).not.toHaveBeenCalled();

    await section(async () => {
      throw new Error("boom");
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toBe("internal error");
  });

  // TEST HAZARD (tasks 6.7): a fake that settles — even after a delay — leaves
  // the timeout branch unreachable and the guard green whether or not the fuse
  // exists. The thunk here must never settle.
  it("resolves a never-settling section as unavailable once the fuse elapses, and logs it", async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const pending = section(() => new Promise<string>(() => {}));
    await vi.advanceTimersByTimeAsync(SECTION_TIMEOUT_MS);

    expect(await pending).toEqual({ ok: false, error: "unavailable" });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toBe("internal error");
  });

  it("fuses at 8 seconds and not before", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(SECTION_TIMEOUT_MS).toBe(8_000);

    let settled = false;
    const pending = section(() => new Promise<string>(() => {})).then((envelope) => {
      settled = true;
      return envelope;
    });

    await vi.advanceTimersByTimeAsync(SECTION_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false, error: "unavailable" });
  });

  it("leaves no pending timer behind when the thunk settles first", async () => {
    vi.useFakeTimers();

    expect(await section(async () => "fast")).toEqual({ ok: true, data: "fast" });

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("monthOf()", () => {
  it("takes the YYYY-MM of the day", () => {
    expect(monthOf("2026-08-20")).toBe("2026-08");
    expect(monthOf("2026-01-01")).toBe("2026-01");
    expect(monthOf("2026-12-31")).toBe("2026-12");
  });
});

describe("windowEndingAt()", () => {
  it("is inclusive at both ends", () => {
    expect(windowEndingAt("2026-08-20", 30)).toEqual({ from: "2026-07-22", to: "2026-08-20" });
    expect(windowEndingAt("2026-08-20", 1)).toEqual({ from: "2026-08-20", to: "2026-08-20" });
    expect(windowEndingAt("2026-08-20", 7)).toEqual({ from: "2026-08-14", to: "2026-08-20" });
  });

  it("spans a year without dropping or adding a day", () => {
    expect(windowEndingAt("2026-08-20", 366)).toEqual({ from: "2025-08-20", to: "2026-08-20" });
  });

  // Local-time arithmetic would shift these by a day for anyone west of UTC in
  // the spring-forward week; the helper works in UTC so it cannot.
  it("does not drift across a DST boundary", () => {
    expect(windowEndingAt("2026-03-10", 5)).toEqual({ from: "2026-03-06", to: "2026-03-10" });
    expect(windowEndingAt("2026-11-03", 5)).toEqual({ from: "2026-10-30", to: "2026-11-03" });
  });

  it("crosses a leap day correctly", () => {
    expect(windowEndingAt("2028-03-01", 2)).toEqual({ from: "2028-02-29", to: "2028-03-01" });
  });
});
