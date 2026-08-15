import { describe, expect, it, vi } from "vitest";
import { logInternalError } from "../../../src/adapters/http/error-logging";

describe("logInternalError", () => {
  it("never throws, even if console.error itself throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementationOnce(() => {
      throw new Error("console is broken");
    });

    expect(() => logInternalError(new Error("whatever"))).not.toThrow();

    spy.mockRestore();
  });

  it("logs the innermost code for a wrapped pg-style error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const pgError = Object.assign(new Error("inner"), { code: "57P01" });
    const outer = new Error("outer", { cause: pgError });

    logInternalError(outer);

    const loggedText = spy.mock.calls.map((call) => JSON.stringify(call)).join("\n");
    expect(loggedText).toContain("57P01");

    spy.mockRestore();
  });
});
