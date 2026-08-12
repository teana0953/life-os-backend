import { describe, expect, it, vi } from "vitest";
import { describeErrorChain, logInternalError } from "../../../src/adapters/http/error-logging";

describe("describeErrorChain", () => {
  it("walks a multi-layer cause chain down to the innermost pg-style error", () => {
    const pgError = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      severity: "ERROR",
      routine: "_bt_check_unique",
    });
    const queryError = new Error("Failed query: insert into users", { cause: pgError });
    const outer = new Error("DrizzleQueryError", { cause: queryError });

    const result = describeErrorChain(outer);

    expect(result.layers).toHaveLength(3);
    const innermost = result.layers[result.layers.length - 1];
    expect(innermost.message).toContain("duplicate key value violates unique constraint");
    expect(innermost.code).toBe("23505");
    expect(innermost.severity).toBe("ERROR");
    expect(innermost.routine).toBe("_bt_check_unique");
    expect(result.truncated).toBe(false);
  });

  it("describes non-Error causes without throwing", () => {
    const throwingToString = { toString: () => { throw new Error("boom"); } };
    const withStringCause = new Error("wrapped", { cause: "just a string" });
    const withObjectCause = new Error("wrapped", { cause: { some: "object" } });
    const withThrowingCause = new Error("wrapped", { cause: throwingToString });
    const withNullCause = Object.assign(new Error("wrapped"), { cause: null });

    for (const err of [withStringCause, withObjectCause, withThrowingCause, withNullCause]) {
      expect(() => describeErrorChain(err)).not.toThrow();
    }

    const stringResult = describeErrorChain(withStringCause);
    expect(stringResult.layers[1].name).toBe("non-error:string");
    expect(stringResult.layers[1].message).toContain("just a string");

    const objectResult = describeErrorChain(withObjectCause);
    expect(objectResult.layers[1].name).toBe("non-error:object");

    const throwingResult = describeErrorChain(withThrowingCause);
    expect(throwingResult.layers[1].name).toBe("non-error:object");
    expect(throwingResult.layers[1].message).toContain("unstringifiable");

    const nullResult = describeErrorChain(withNullCause);
    expect(nullResult.layers).toHaveLength(2);
    expect(nullResult.layers[1].name).toBe("non-error:object");
    expect(nullResult.layers[1].message).toBe("null");
  });

  it("terminates on a circular cause chain within the depth limit", () => {
    const a: Error & { cause?: unknown } = new Error("a");
    const b: Error & { cause?: unknown } = new Error("b");
    a.cause = b;
    b.cause = a;

    const result = describeErrorChain(a);

    expect(result.layers.length).toBeLessThanOrEqual(8);
    expect(result.truncated).toBe(true);
  });

  it("redacts connection strings and drizzle params from message and detail", () => {
    const pgError = Object.assign(
      new Error("connect failed: postgres://user:hunter2@host/db params: sensitive-uid-123"),
      { detail: "constraint violated, params: sensitive-uid-123" },
    );

    const result = describeErrorChain(pgError);
    const layer = result.layers[0];

    expect(layer.message).not.toContain("hunter2");
    expect(layer.message).not.toContain("sensitive-uid-123");
    expect(layer.detail).not.toContain("sensitive-uid-123");
    expect(layer.message).toContain("connect failed");
    expect(layer.detail).toContain("constraint violated");
  });

  it("does not throw when the cause getter itself throws", () => {
    const malicious = new Error("malicious");
    Object.defineProperty(malicious, "cause", {
      get() {
        throw new Error("getter boom");
      },
    });

    expect(() => describeErrorChain(malicious)).not.toThrow();
    const result = describeErrorChain(malicious);
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0].message).toBe("malicious");
  });
});

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
