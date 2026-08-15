/**
 * The error shape the redaction guards are aimed at: a real
 * `DrizzleQueryError` wrapping a real pg error.
 *
 * The fixture shape IS the guard. `DrizzleQueryError`'s constructor builds its
 * message as `` `Failed query: ${query}\nparams: ${params}` `` (verified
 * against node_modules/drizzle-orm/errors.js), so the bound parameter values
 * — the row data — travel inside the OUTER error's message, not in a field a
 * generic serializer would skip. The pg cause carries the row value a second
 * time inside `invalid input syntax for type uuid: "<value>"` and a third in
 * the constraint `detail`. An invented "boom" error would let a redaction that
 * covers none of these look effective.
 */

/** A user's email, bound as a query parameter — must never reach a log. */
export const SECRET_PARAM_VALUE = "alice@example.com";

/** A row value pg echoes back inside its own message text. */
export const SECRET_ROW_VALUE = "not-a-uuid-alice-9f3b";

/** Kept, not redacted: it names the failure class, not the person. */
export const DIAGNOSTIC_PG_CODE = "22P02";

export function drizzleQueryErrorWithPgCause(): Error {
  const pgError = Object.assign(new Error(`invalid input syntax for type uuid: "${SECRET_ROW_VALUE}"`), {
    code: DIAGNOSTIC_PG_CODE,
    severity: "ERROR",
    routine: "string_to_uuid",
    detail: `Key (email)=(${SECRET_PARAM_VALUE}) already exists.`,
  });
  const outer = new Error(
    `Failed query: select "users"."id" from "users" where "users"."email" = $1\nparams: ${SECRET_PARAM_VALUE},${SECRET_ROW_VALUE}`,
    { cause: pgError },
  );
  return outer;
}
