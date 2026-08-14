/**
 * Classifier for neon HTTP request bodies: is this request safe to send twice?
 *
 * The neon serverless driver POSTs either `{query, params}` (one statement) or
 * `{queries: [{query, params}, ...]}` (db.batch()). A 520/502/network failure
 * means "no valid response", NOT "the statement did not run" — so a retry is
 * only safe when re-running the statement cannot change anything.
 *
 * This is an allowlist, never a blacklist: the body must parse, every statement
 * must start with `select` or `with`, and none may contain a construct that
 * writes, locks, or advances a sequence. Anything unrecognised is refused.
 *
 * It is deliberately NOT a SQL tokenizer. It cannot tell a keyword from the
 * same word inside a string literal, so `select 'insert' as a` is refused. That
 * is the only direction it is allowed to be wrong in: a false negative costs a
 * retry the caller never had before, while a false positive could double a
 * stock decrement or a ledger row.
 */

/** `-- ...` to end of line, or `/* ... *\/`, anchored at the start. */
const LEADING_COMMENT = /^(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)/;

/**
 * The accepted opening keywords.
 *
 * `with` is accepted, and it is the FORBIDDEN list below — not this check —
 * that keeps data-modifying CTEs out. That is sound because Postgres gives a
 * CTE no way to write without naming one of four keywords: the only statements
 * permitted inside a `WITH` body are SELECT, VALUES, TABLE, INSERT, UPDATE,
 * DELETE and (since PG17) MERGE, and the statement a WITH clause attaches to
 * is likewise one of those. All four writing forms are matched by
 * `\binsert\b`, `\bupdate\b`, `\bdelete\b`, `\bmerge\b`. So opening with `with`
 * cannot smuggle a write past a scan that already rejects those words
 * anywhere in the statement; the first-keyword check was a second gate on a
 * case the FORBIDDEN scan already covered.
 *
 * What this does NOT close, and never did: a `SELECT` that calls a volatile
 * function which writes (`select my_side_effecting_fn()`). That hole is
 * identical for a plain select, which has always been accepted, so admitting
 * `with` widens nothing. The specific write-ish functions this codebase could
 * plausibly reach are blocked by name below (`nextval`, `setval`,
 * `pg_advisory*`).
 *
 * Why it matters rather than being a tidy-up: the repo has three CTEs, and two
 * of them (drizzle-balance-repository.ts:101 and :198, `with net as (select
 * ... union all select ...)`) are the read behind `/api/split/balances` —
 * an endpoint that 500'd in both the 2026-08-14 12:09 and 12:35 incidents.
 * Under a `^select`-only rule this fix would have done nothing for it. The
 * third (drizzle-friend-invite-repository.ts:127, `with claimed as (update
 * ...)`) is a write and stays refused, by `\bupdate\b` and `\binsert\b`.
 * All three are pinned as fixtures captured from the live driver in
 * test/shared/db/neon-integration.test.ts.
 */
const OPENS_READ_ONLY = /^(?:select|with)\b/i;

/**
 * Constructs that disqualify an otherwise-select statement.
 *
 * Every pattern is word-bounded, and that is load-bearing rather than
 * stylistic: `updated_at` is a real column read by queries across split,
 * health and finance, so a plain substring test for `update` would reject
 * essentially every read and the retry would silently never fire.
 */
// No rule here may be redundant with another. `for update` and `for no key
// update` used to have their own patterns; both are strict subsets of the bare
// `\bupdate\b` rule, so each of the three could be deleted with the whole suite
// still green — two rules covering one case looks like defence in depth but
// means neither is actually proven to hold. They were removed; `\bupdate\b`
// alone now carries the row-lock case, and the `for update of s` test below
// reddens if it goes. `for share` / `for key share` share no other rule and
// keep their own, each with a test that reddens on its own removal.
//
// Admitting `with` above does not disturb that: the subset relation is between
// patterns, and every pattern is scanned unanchored over the whole statement
// regardless of which keyword opened it. `for update` is still spelled with
// the word `update`.
//
// `\bupdate\b` now also carries the write-CTE case, which is why there is a
// fixture whose ONLY forbidden word is `update` (a `with x as (update ...
// returning ...) select` — the friend-invite statement says both `update` and
// `insert into`, so on its own it cannot prove any single rule).
const FORBIDDEN = [
  /\bfor\s+share\b/i,
  /\bfor\s+key\s+share\b/i,
  /\binsert\b/i,
  /\bupdate\b/i,
  /\bdelete\b/i,
  /\bmerge\b/i,
  /\binto\b/i,
  /\bnextval\b/i,
  /\bsetval\b/i,
  /\bpg_advisory\w*\b/i,
];

function stripLeadingNoise(statement: string): string {
  let rest = statement.trimStart();
  // Comments may be stacked and interleaved with whitespace, so keep going
  // until neither a comment nor whitespace is left at the front.
  for (;;) {
    const stripped = rest.replace(LEADING_COMMENT, "").trimStart();
    if (stripped === rest) return stripped;
    rest = stripped;
  }
}

function isReadOnlyStatement(statement: unknown): boolean {
  if (typeof statement !== "string") return false;
  // A trailing `;` needs no handling: the keyword check is anchored at the
  // start and the forbidden patterns are unanchored, so stripping one could
  // never change a verdict. (An earlier draft did strip it; mutation testing
  // showed the strip was inert, so it was removed rather than left as a guard
  // that cannot fail.)
  const sql = stripLeadingNoise(statement);
  if (!OPENS_READ_ONLY.test(sql)) return false;
  return !FORBIDDEN.some((pattern) => pattern.test(sql));
}

type ParsedBody = { statements: unknown[]; isBatch: boolean };

function parseBody(body: unknown): ParsedBody | null {
  if (typeof body !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { query, queries } = parsed as { query?: unknown; queries?: unknown };
  if (queries !== undefined) {
    if (!Array.isArray(queries)) return null;
    return { statements: queries.map((entry) => (entry as { query?: unknown } | null)?.query), isBatch: true };
  }
  if (query !== undefined) return { statements: [query], isBatch: false };
  return null;
}

/**
 * True only when re-sending this exact body is guaranteed to be harmless.
 *
 * An empty `queries` array returns false: `[].every(...)` is vacuously true, so
 * without the explicit length check this function would happily approve a body
 * it never actually inspected.
 */
export function isRetryableReadOnlyBody(body: unknown): boolean {
  const parsed = parseBody(body);
  if (parsed === null || parsed.statements.length === 0) return false;
  return parsed.statements.every(isReadOnlyStatement);
}

/**
 * A shape-only descriptor for log lines: first keyword, statement count, and
 * whether it was a batch. Never any SQL text, table/column names, or params —
 * those must not reach the Workers log.
 */
export function describeQueryShape(body: unknown): string {
  const parsed = parseBody(body);
  if (parsed === null) return "unparsed";
  const first = parsed.statements[0];
  const keyword = typeof first === "string" ? (stripLeadingNoise(first).match(/^[a-z]+/i)?.[0]?.toLowerCase() ?? "unknown") : "unknown";
  return `${parsed.isBatch ? "batch " : ""}${keyword} x${parsed.statements.length}`;
}
