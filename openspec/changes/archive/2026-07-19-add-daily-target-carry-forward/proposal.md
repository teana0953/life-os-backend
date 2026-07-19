# Carry-forward daily portion target

## Why

Daily targets are stored per `(user, day)`. When a day has no target row, the
system reports a zero base — so every new day looks "reset" and the user must
re-enter the same goals. The user wants a day with no explicitly-set target to
**carry forward the most recently set target** instead of resetting.

## What Changes

- A day **with** its own target keeps today's behavior: `base + bonus`.
- A day **without** its own target derives its base from the most recent target
  set on or before that day (carry-forward); `bonus` is 0 (a day the user never
  touched earns no exercise bonus).
- A user who has never set any target still reports all-zero.
- `setDailyTarget`, entry create/delete/list, the schema, and the HTTP contract
  are unchanged — only the *base source* when reading a day's target changes.
- Frontend needs no change: `GET /api/daily-target` returns the carried-forward
  value transparently.

## Impact

- Affected spec: `diet-tracking` — the "Daily portion target" requirement gains
  carry-forward semantics.
- Affected code: `DailyTargetRepository` (new read primitive),
  `getDailyTargetWithRemaining` use case, `DrizzleDailyTargetRepository`.
