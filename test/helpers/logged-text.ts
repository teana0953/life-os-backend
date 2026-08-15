/**
 * Renders captured `console.error` arguments the way a log sink that walks
 * objects would — NOT the way `JSON.stringify` would.
 *
 * `JSON.stringify(["msg", err])` yields `["msg",{}]` for any `Error`: name,
 * message, stack and cause all vanish because they are non-enumerable. A guard
 * asserting "the logged text does not contain the secret" over that string
 * stays green after the redaction is reverted to `console.error(msg, err)` —
 * an assertion that cannot fail. The same trap applies one level in, via a
 * plain object holding an `Error` (`{ userId, error }`), so this walks into
 * objects too.
 */
const MAX_DEPTH = 10;

export function flattenLoggedArgs(args: unknown[]): string {
  return args.map((arg) => flatten(arg, 0)).join(" | ");
}

/** Everything a `console.error` spy captured, as one searchable string. */
export function loggedTextFrom(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((call) => flattenLoggedArgs(call)).join("\n");
}

function flatten(value: unknown, depth: number): string {
  if (depth > MAX_DEPTH) return "[max-depth]";
  if (value instanceof Error) {
    const parts = [value.name, value.message, value.stack ?? ""];
    for (const key of ["code", "detail", "severity", "routine", "status", "query", "params"]) {
      const field = (value as unknown as Record<string, unknown>)[key];
      if (field !== undefined) parts.push(`${key}=${flatten(field, depth + 1)}`);
    }
    const cause = (value as { cause?: unknown }).cause;
    if (cause !== undefined) parts.push(`cause=${flatten(cause, depth + 1)}`);
    return parts.join(" ");
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value)
      .map(([key, nested]) => `${key}=${flatten(nested, depth + 1)}`)
      .join(" ");
  }
  return String(value);
}
