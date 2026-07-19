# Design — Logged days in a month

## Context

`food_entry` rows carry a `day` (Postgres `date`). The frontend calendar wants
the set of days in a month that have any entry. We add one owner-scoped read
query; nothing else changes.

## Decisions

### D1 — Endpoint under the existing `/api/diet-entries` prefix

`GET /api/diet-entries/logged-days?month=YYYY-MM`. The existing routes are
`POST /api/diet-entries`, `GET /api/diet-entries?day=`,
`DELETE|PATCH /api/diet-entries/:id`. The new static sub-path `logged-days` must
not be captured by `:id`. Hono's `RegExpRouter` matches static segments before a
`:param`, so `logged-days` resolves to the new handler, not `:id` with
`id="logged-days"`. A route test asserts this (hitting `logged-days` returns the
days payload, not a 404/entry-not-found), guarding against a future router
change.

### D2 — Month range query (avoid the invalid-date upper bound)

Add `listLoggedDays(userId, month): Promise<string[]>` to the `DietLogRepository`
port. Drizzle implementation:

```
selectDistinct({ day: foodEntry.day })
  .where(and(
    eq(foodEntry.userId, userId),
    gte(foodEntry.day, `${month}-01`),
    sql`${foodEntry.day} < (${month + "-01"})::date + interval '1 month'`,
  ))
  .orderBy(asc(foodEntry.day))
```

**Do not** bound the upper end with `${month}-31`: Postgres rejects `'2026-02-31'`
as an out-of-range `date`, so a February query would error. Use a half-open range
`[month-01, firstOfNextMonth)` computed in SQL via `+ interval '1 month'` on the
month's first day, which is always a valid date. Return the `day` strings as-is
(already `YYYY-MM-DD`), ascending; `selectDistinct` + a single `day` column
yields unique days.

### D3 — `requireMonth` validator

Add to `validation.ts`, mirroring `requireDay`: `requireMonth(value, field="month")`
requires a string matching `^\d{4}-(0[1-9]|1[0-2])$` (4-digit year, month 01–12);
anything else throws `BadRequestError` → 400. The route reads
`c.req.query("month")` through it.

### D4 — Use case + handler

`getLoggedDays(repo, userId, month)` returns `repo.listLoggedDays(userId, month)`.
`createGetLoggedDaysHandler` reads the authed `userId`, validates `month`, and
responds `{ days }`. Owner-scoped via the `userId` filter — no cross-user leak.

## Testing

- Use-case / repo via in-memory fake (extend the existing diet-log fake with
  `listLoggedDays`): distinct days only (two entries same day → one), sorted
  ascending, other months excluded, empty month → `[]`, owner isolation.
- HTTP route tests through the real app: happy path shape `{ days: [...] }`;
  missing/malformed `month` → 400; `logged-days` not swallowed by `:id`;
  no auth → 401.
- The February upper-bound case is covered by the range logic; a repo-level test
  with a Feb month confirms no error and correct filtering.
