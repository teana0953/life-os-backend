# Design — diet import: split snacks by time into separate meals

## Problem

The diet import merges all chaodays `extra` records of a day into ONE meal named
`"點心"`. The user records multiple snacks at different times of day and wants each
kept as a **separate** snack (as the app models them), not collapsed into one.

lifeos snack model (frontend `meal_label.dart` + `snack_naming.dart`): a meal whose
value is not `breakfast`/`lunch`/`dinner` is a snack shown by its own name; multiple
snacks in a day are named `點心`, `點心2`, `點心3`, … (`nextSnackName`: base word,
then base+`max(existing number)+1`).

## Decision

Keep standard meals (breakfast/lunch/dinner) as-is — one merged meal per (day,
code). Change only **`extra` (snack) handling**:

- Within a day, group `extra` records by their `recorded_at` **time** (records
  sharing an exact time merge into one snack — matching how standard meals merge).
- Each distinct snack time becomes its **own** snack meal, with that time and its
  own items.
- **Idempotency by (day, time):** skip creating a snack for a time that already has
  a snack in lifeos for that day (read from the existing-meals snapshot — a snack is
  any existing meal whose name is not a standard code). So re-importing the same
  range under this change adds nothing. (Caveat: this holds against snacks written by
  THIS change. Diet data previously written under the old merged-`點心` behavior would
  only match on the merged snack's single time — but the user's pre-change diet data
  was already deleted, so their re-import starts clean; no migration is needed here.)
- **Naming:** assign each *new* snack the next name via the app's rule — `點心`, then
  `點心{N+1}` where N is the max number among the day's existing snack names
  (`點心`=1) **and** the snacks already assigned in this import for that day. This
  matches `nextSnackName` and stays unique per day.
- Order snacks by time ascending so names track chronological order on a clean
  import.

Glucose extraction is unchanged: still parsed from **every** item (standard and
snack, skipped or not) and merged/deduped into the day's vitals.

## Behavior preserved

- Standard meals: unchanged (skip pre-existing (day, code); merge same-code records;
  same time/portion/glucose handling).
- Glucose dedup + other-vitals preservation unchanged.
- Meal time uses the record's `recorded_at` at +08:00 (from #45) — for a snack, its
  own time; for a merged standard meal, the first record's time as today.
- Summary counts: each created meal (standard or snack) counts toward
  `mealsImported`; a skipped (day, code) or a snack-time already present counts as
  `mealsSkipped`.
- Batched persistence (one `createMeals`, one `setMany`) from #43/#45 unchanged — the
  extra entries/items just become more (per-snack) rows in the same batch.

## Scope

Only the snack grouping/naming in `import-chaodays-diet.ts` (+ tests). No repo/schema
change. Standard-meal behavior, batching, timezone, and glucose all untouched.
Gate = `npm test` + `npm run typecheck`.

## Testing

- A day with three `extra` records at 10:00 / 15:00 / 21:00 → three snacks named
  `點心`, `點心2`, `點心3`, each with its own time and items (not one merged 點心).
- Two `extra` records at the same time → one snack.
- Re-import: a snack time already present is skipped (idempotent); a day that already
  has a `點心` gets the next new snack named `點心2`.
- Standard meals still merge to one per (day, code); glucose still extracted from all
  items. Existing diet tests updated for the new snack shape.
