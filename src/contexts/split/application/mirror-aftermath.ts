import type { ShareMirrorRow, SharesMirror } from "../domain/shares-mirror";
import { describeErrorChain } from "../../../shared-kernel/error-logging";

/**
 * Runs the mirror's post-write side effects (the share holders' budget-alert
 * checks) on the same best-effort terms `createTransaction` already uses for
 * its own: the split is already committed by the time this runs, so letting a
 * failing check propagate would report a failure for a write that happened.
 *
 * Shared by `createExpense` and `updateExpense` so the two can never disagree
 * about whether a failing alert loses a split.
 */
export async function writeMirrorAftermath(mirror: SharesMirror, rows: ShareMirrorRow[]): Promise<void> {
  try {
    await mirror.afterWrite(rows);
  } catch (err) {
    console.error("split mirror afterWrite failed", describeErrorChain(err));
  }
}
