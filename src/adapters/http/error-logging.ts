import { describeErrorChain } from "../../shared-kernel/error-logging";

// Fallback logging for the onError boundary in app.ts: when an error doesn't
// match any of the known instanceof branches, we still want to know *why* it
// happened, without ever throwing or looping while trying to log. The
// description (and its redaction rules) comes from shared-kernel, which the
// application layer also uses; "internal error" is this HTTP boundary's own
// vocabulary and stays here.

export function logInternalError(err: unknown): void {
  try {
    const description = describeErrorChain(err);
    console.error("internal error", description);
  } catch {
    console.error("internal error (logging failed)");
  }
}
