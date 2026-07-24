## Why

The diet import merges all chaodays `extra` records of a day into ONE meal named
`"點心"`. The user records multiple snacks at different times and wants each kept as a
separate snack — as the app models them (`meal_label.dart`/`snack_naming.dart`: a
non-standard meal value is a snack shown by its own name; multiple snacks in a day are
`點心`, `點心2`, `點心3`, …). Standard meals (breakfast/lunch/dinner) are fine as one
per day.

## What Changes

- Diet import splits `extra` records: within a day, group them by their `recorded_at`
  **time** (same-time records merge into one snack), and create a **separate snack
  meal per distinct time**, each with its own time and items — instead of one merged
  `點心`.
- **Naming** follows the app's rule: each new snack gets `點心`, then `點心{N+1}`
  where N is the max number among the day's existing snack names (bare `點心`=1) plus
  the snacks already assigned this import; ordered by time ascending.
- **Idempotency by (day, time):** a snack time that already has a snack in lifeos for
  that day is skipped, so re-import adds nothing.
- Standard-meal handling, glucose extraction/dedup, +08:00 time, and batched
  persistence are unchanged.

Only `import-chaodays-diet.ts` (+ tests). Gate = `npm test` + `npm run typecheck`.

## Capabilities

### Modified Capabilities

- `chaodays-import`: the diet import SHALL import each chaodays extra record as a
  separate snack meal keyed by its time (same-time records merged), named per the
  app's snack-naming rule, rather than merging all of a day's extra records into one
  snack — with standard-meal, glucose, timezone, and idempotency behavior otherwise
  preserved.
