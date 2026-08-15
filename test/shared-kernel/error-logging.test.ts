import { describe, expect, it } from "vitest";
import { describeErrorChain } from "../../src/shared-kernel/error-logging";

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

  it("redacts the row value from a pg unique-violation detail while keeping the column name", () => {
    const pgError = Object.assign(new Error("duplicate key value violates unique constraint"), {
      detail: "Key (email)=(alice@example.com) already exists.",
    });

    const result = describeErrorChain(pgError);
    const layer = result.layers[0];

    expect(layer.detail).not.toContain("alice@example.com");
    expect(layer.detail).toContain("Key (email)");
    expect(layer.detail).toContain("already exists");
  });

  it("redacts the whole tuple from pg's `Failing row contains` detail", () => {
    // pg attaches this detail to not-null and check-constraint violations on
    // INSERT/UPDATE — the shape the finance writes hit — and it dumps every
    // column of the row, not just the offending one.
    const pgError = Object.assign(
      new Error('null value in column "email" of relation "users" violates not-null constraint'),
      {
        code: "23502",
        // The second value contains a `)` of its own: a rule that stopped at
        // the first closing paren would leave the rest of the row behind.
        detail: "Failing row contains (uuid-1, alice@example.com, note (paid), 12345, 2026-01-01).",
      },
    );

    const layer = describeErrorChain(pgError).layers[0];

    expect(layer.detail).not.toContain("alice@example.com");
    expect(layer.detail).not.toContain("uuid-1");
    expect(layer.detail).not.toContain("12345");
    expect(layer.detail).toContain("Failing row contains");
    // The message names the column and constraint class — that half stays.
    expect(layer.message).toContain('column "email"');
    expect(layer.code).toBe("23502");
  });

  it("redacts the quoted row value from pg's fixed-syntax cast and enum messages, keeping the type name", () => {
    const castError = Object.assign(new Error('invalid input syntax for type uuid: "not-a-uuid-alice-9f3b"'), { code: "22P02" });
    const enumError = new Error('invalid input value for enum finance_transaction_type: "grocerie"');

    const castLayer = describeErrorChain(castError).layers[0];
    expect(castLayer.message).not.toContain("not-a-uuid-alice-9f3b");
    expect(castLayer.message).toContain("invalid input syntax for type uuid");
    expect(castLayer.code).toBe("22P02");

    const enumLayer = describeErrorChain(enumError).layers[0];
    expect(enumLayer.message).not.toContain("grocerie");
    expect(enumLayer.message).toContain("invalid input value for enum finance_transaction_type");
  });

  it("leaves pg's quoted relation and constraint names alone — they name the failure, not the row", () => {
    // The rejected blanket rule (strip every double-quoted span) would take
    // these too, which is the whole diagnostic half of the boundary.
    const missingRelation = new Error('relation "finance_transaction" does not exist');
    const constraint = new Error('duplicate key value violates unique constraint "users_firebase_uid_key"');

    expect(describeErrorChain(missingRelation).layers[0].message).toContain('"finance_transaction"');
    expect(describeErrorChain(constraint).layers[0].message).toContain('"users_firebase_uid_key"');
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
