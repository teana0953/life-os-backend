// Flattens an unknown thrown value into a loggable, redacted description of
// its whole cause chain — so a failure buried under a DrizzleQueryError
// wrapper can still be identified — without ever throwing or looping while
// doing so.
//
// The redaction boundary: anything identifying *which code and which class of
// failure* is kept (error name, pg `code`/`severity`/`routine`, the column
// name half of a constraint detail, type/enum names, the first stack line, the
// chain depth); anything identifying *which row or which person* is stripped.
//
// redact() covers six known shapes: connection strings
// (postgres://user:pass@host/db), drizzle's "params: ..." suffix appended to
// query-error messages, the value half of pg's constraint-violation detail
// line ("Key (col)=(value) already exists." -> value redacted, column name
// kept), the quoted row value in pg's two fixed-syntax messages
// `invalid input syntax for type <type>: "<value>"` and
// `invalid input value for enum <enum>: "<value>"` (value redacted, type/enum
// name kept), and the whole tuple in pg's `Failing row contains (...)` detail,
// which accompanies not-null and check-constraint violations on INSERT/UPDATE.
//
// Coverage is a list of specific shapes, not a general guarantee: it is only
// row data that pg (or drizzle) wraps in syntax this module recognises. A row
// value that some other error class drops into a message with no fixed syntax
// around it passes through unredacted, and any pg message shape not listed
// above does too — if a new one shows up, add a rule and a test rather than
// assuming it is already handled. Stripping every double-quoted span would be
// the general rule, and is deliberately rejected: pg puts relation, column and
// constraint names in double quotes far more often than row values
// (`relation "finance_transaction" does not exist`, `violates unique
// constraint "users_firebase_uid_key"`), so a blanket rule would destroy the
// diagnostic half of the boundary above to catch the rarer case.

const MAX_DEPTH = 8;
const MAX_FIELD_LENGTH = 2000;

type ErrorLayer = {
  name: string;
  message: string;
  code?: string;
  status?: string;
  severity?: string;
  routine?: string;
  detail?: string;
};

type ErrorChainDescription = {
  layers: ErrorLayer[];
  innermostStack?: string;
  truncated: boolean;
};

function redact(value: string): string {
  let result = value.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-connection-string]");
  result = result.replace(/params:.*/is, "[redacted-params]");
  // Postgres formats unique/foreign-key violation detail as
  // `Key (col)=(value) already exists.` — the column name is a useful
  // identifier for the failure class, but the value is row data (e.g. a
  // user's email or firebase_uid) and must not be logged.
  result = result.replace(/(Key\s*\([^)]*\))=\([^)]*\)/gi, "$1=([redacted])");
  result = result.replace(
    /(invalid input (?:syntax for type|value for enum) [^:]*: )"[^"]*"/gi,
    '$1"[redacted]"',
  );
  // Postgres attaches `Failing row contains (v1, v2, ...)` as the detail of a
  // not-null or check-constraint violation on INSERT/UPDATE — that is the
  // whole row, so the whole tuple goes. Greedy to the last `)` on the line so
  // a value containing `)` cannot leave a tail behind.
  result = result.replace(/(Failing row contains )\(.*\)/gi, "$1([redacted])");
  if (result.length > MAX_FIELD_LENGTH) {
    result = `${result.slice(0, MAX_FIELD_LENGTH)}…[truncated]`;
  }
  return result;
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "[unstringifiable]";
  }
}

function pgField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function describeErrorChain(err: unknown): ErrorChainDescription {
  const layers: ErrorLayer[] = [];
  let current: unknown = err;
  let innermostStack: string | undefined;
  let truncated = false;

  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (depth === MAX_DEPTH - 1 && current instanceof Error) {
      let cause: unknown;
      try {
        cause = (current as { cause?: unknown }).cause;
      } catch {
        cause = undefined;
      }
      if (cause !== undefined) truncated = true;
    }
    if (current instanceof Error) {
      layers.push({
        name: current.name,
        message: redact(current.message),
        code: pgField((current as { code?: unknown }).code),
        status: pgField((current as { status?: unknown }).status),
        severity: pgField((current as { severity?: unknown }).severity),
        routine: pgField((current as { routine?: unknown }).routine),
        detail: (() => {
          const detail = pgField((current as { detail?: unknown }).detail);
          return detail === undefined ? undefined : redact(detail);
        })(),
      });
      if (typeof current.stack === "string") {
        innermostStack = redact(current.stack.split("\n")[0] ?? current.stack);
      }
      let cause: unknown;
      try {
        cause = (current as { cause?: unknown }).cause;
      } catch {
        break;
      }
      if (cause === undefined) break;
      current = cause;
    } else {
      layers.push({ name: `non-error:${typeof current}`, message: redact(safeString(current)) });
      break;
    }
  }

  return { layers, innermostStack, truncated };
}
