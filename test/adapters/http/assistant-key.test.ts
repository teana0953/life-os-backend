import type { Context } from "hono";
import { describe, expect, it } from "vitest";
import { ASSISTANT_HEALTH_HEADER, resolveHealthOptIn } from "../../../src/adapters/http/routes/assistant-key";

function requestWith(value: string | undefined): Context {
  return { req: { header: (name: string) => (name === ASSISTANT_HEALTH_HEADER ? value : undefined) } } as unknown as Context;
}

describe("the health opt-in header", () => {
  it("is on for the exact agreed value and off for everything else", async () => {
    // Fail closed: a typo, a different casing, or a value the frontend
    // invented must not silently ship menstrual and glucose records to a
    // provider the caller never agreed to.
    const readings = [undefined, "", " ", "ON", "On", "true", "1", "yes", "onn", "off"].map((value) => [
      String(value),
      resolveHealthOptIn(requestWith(value)),
    ]);

    expect(readings).toEqual([
      ["undefined", false],
      ["", false],
      [" ", false],
      ["ON", false],
      ["On", false],
      ["true", false],
      ["1", false],
      ["yes", false],
      ["onn", false],
      ["off", false],
    ]);
    expect(resolveHealthOptIn(requestWith("on"))).toBe(true);
  });
});
