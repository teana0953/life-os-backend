import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeMirrorAftermath } from "../../../../src/contexts/split/application/mirror-aftermath";
import type { ShareMirrorRow, SharesMirror } from "../../../../src/contexts/split/domain/shares-mirror";
import {
  DIAGNOSTIC_PG_CODE,
  SECRET_PARAM_VALUE,
  SECRET_ROW_VALUE,
  drizzleQueryErrorWithPgCause,
} from "../../../helpers/drizzle-error";
import { loggedTextFrom } from "../../../helpers/logged-text";

/**
 * The split write is already committed when this runs, so the failure is
 * swallowed and only ever seen as a log line — which is exactly why the log
 * line must not carry the mirrored rows' data.
 */

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("writeMirrorAftermath", () => {
  it("redacts the DB error it logs while keeping the pg diagnostic", async () => {
    const mirror = {
      plan: async () => [],
      afterWrite: async (): Promise<never> => {
        throw drizzleQueryErrorWithPgCause();
      },
    } as unknown as SharesMirror;
    const rows: ShareMirrorRow[] = [];

    await expect(writeMirrorAftermath(mirror, rows)).resolves.toBeUndefined();

    const text = loggedTextFrom(errorSpy);
    expect(text).toContain("split mirror afterWrite failed");
    expect(text).not.toContain(SECRET_PARAM_VALUE);
    expect(text).not.toContain(SECRET_ROW_VALUE);
    expect(text).toContain(DIAGNOSTIC_PG_CODE);
    expect(text).toContain("invalid input syntax for type uuid");
  });
});
