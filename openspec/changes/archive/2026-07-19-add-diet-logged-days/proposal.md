# Logged days in a month

## Why

The frontend diet calendar needs to mark which days in a month have at least one
food entry (so the user can see, at a glance, which days they logged). Today the
API can only fetch a single day's entries; there is no way to ask "which days in
July have any entry?" without fetching all 31 days.

## What Changes

- New read-only endpoint `GET /api/diet-entries/logged-days?month=YYYY-MM`
  (behind auth, owner-scoped): returns the distinct calendar dates in that month
  on which the user has at least one food entry, ascending:
  `{ "days": ["2026-07-01", "2026-07-04", ...] }`.
- `month` is required and must be `YYYY-MM`; anything else is a 400 client error.
- No change to create/delete/update/day-view, daily-target, or the schema — this
  adds one read-only query path.

## Impact

- Affected spec: `diet-tracking` — a new "Logged days in a month" requirement.
- Affected code: `DietLogRepository` (new read method), a `getLoggedDays` use
  case, `DrizzleDietLogRepository`, a `requireMonth` validator, and one route.
