// Fallback logging for the onError boundary in app.ts: when an error doesn't
// match any of the known instanceof branches, we still want to know *why* it
// happened (e.g. a Postgres error buried under a DrizzleQueryError wrapper),
// without leaking secrets (connection strings, SQL params, row values) into
// logs, and without ever throwing or looping while trying to log.

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

export function logInternalError(err: unknown): void {
  try {
    const description = describeErrorChain(err);
    console.error("internal error", description);
  } catch {
    console.error("internal error (logging failed)");
  }
}
