# Design — Carry-forward daily portion target

## Context

`daily_target` rows are keyed `(user, day)`. Today `getDailyTargetWithRemaining`
calls `DailyTargetRepository.get(userId, day)` (exact day) and falls back to a
zero base/bonus when that day has no row. We want the *base* to instead carry
forward from the most recent target the user set on or before that day, while
leaving everything else (bonus semantics, set/upsert, schema, HTTP) untouched.

## Decisions

### D1 — New read primitive `getLatestOnOrBefore`, keep `get` as-is

Add to the `DailyTargetRepository` port:

```ts
/** Most recent target with day <= the given day, or null if none. */
getLatestOnOrBefore(userId: string, day: string): Promise<DailyTarget | null>;
```

`get(userId, day)` (exact day, incl. bonus) stays unchanged — its only caller
(the use case) still needs the exact-day lookup to decide whether the day has
its own target and thus its own bonus. Keeping `get` means its existing tests
and the set/HTTP paths are wholly untouched (surgical change).

Rationale for a data-access primitive (not baking carry-forward into `get`):
carry-forward is composed in the application layer; the repo just exposes "exact
day" and "latest on-or-before" as two distinct data queries. ISO `YYYY-MM-DD`
day strings sort lexicographically in calendar order, so the Drizzle query is
`where userId AND day <= day, order by day desc, limit 1`.

### D2 — Use case composes exact-day + carry-forward

`getDailyTargetWithRemaining`:

1. `exact = get(userId, day)`.
2. If `exact` is non-null → `base = exact.base`, `bonus = exact.bonus`
   (today's behavior, unchanged — an explicitly-set day, even all-zero, wins).
3. If `exact` is null → `carry = getLatestOnOrBefore(userId, day)`;
   `base = carry?.base ?? ZERO`, `bonus = ZERO` (carried-forward base, no bonus).

`effective = base + bonus`, `logged`, and `remaining` are computed exactly as
before. The `carry` query only runs when the day has no exact row, so it always
returns a strictly-earlier target (or null).

### D3 — Everything else unchanged

`setDailyTarget`, `food_entry` create/delete/list, the DB schema, the
`GET/PUT /api/daily-target` HTTP contract, and validation are untouched. The
frontend reads the carried-forward base transparently via the existing GET.

## Testing

- Use-case unit tests (in-memory fake repo implementing the new method):
  - day with its own target → base+bonus from that day (regression, unchanged).
  - day with no target but an earlier one → base = earlier base, bonus = 0.
  - day with no target and none earlier (never set) → all-zero.
  - an untouched day *after* a nonzero-bonus target carries that base but bonus 0
    (the source day's bonus does not leak forward).
- `DrizzleDailyTargetRepository.getLatestOnOrBefore` ordering/`<=` boundary is
  covered by the in-memory fake at the use-case level; the SQL mirrors `get`.
