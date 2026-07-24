# Tasks

## 1. Split snacks in importChaodaysDiet (TDD)
- [ ] Keep standard records (breakfast/lunch/dinner) grouped by code → one merged
      meal per (day, code), exactly as now.
- [ ] For `extra` records of a day: group by `recorded_at` time (same time → one
      snack, items merged); order the distinct times ascending.
- [ ] Determine the day's existing snack names from the existing-meals snapshot (a
      snack = an existing meal whose name is NOT a standard code breakfast/lunch/dinner)
      and existing snack TIMES.
- [ ] Idempotency: skip a snack whose time already has a snack that day (counts as
      skipped). For each new snack time, create a snack meal with that time + items,
      named by the app rule: base word `點心` for the first, then `點心{N+1}` where N
      is the max snack number among the day's existing snack names (bare `點心`=1) plus
      snacks already assigned in this import for the day.
- [ ] Add a small pure helper for the next snack name (mirror of frontend
      `nextSnackName`: regex `^點心(\d+)?$`, max+1) so it's unit-testable.
- [ ] Glucose extraction unchanged (from every item, standard + snack); +08:00 time
      unchanged (each snack uses its own recorded_at); batched persistence (createMeals
      + setMany) unchanged — just more per-snack entries/items in the same batch.
- [ ] Minor consistency: make the malformed-`recorded_at` fallback use the +08:00
      offset too (`new Date(\`${day}T00:00:00+08:00\`)`) so a fallback snack's instant
      matches the timezone of real ones (defensive-only; keeps re-import idempotent).
- [ ] Summary counts: each created meal (standard or snack) → mealsImported; a skipped
      (day, code) or an already-present snack time → mealsSkipped.

## 2. Tests
- [ ] Three extra records at distinct times → three snacks `點心`/`點心2`/`點心3`, each
      with its own time + items (not one merged snack).
- [ ] Two extra records at the same time → one snack.
- [ ] Re-import: an existing snack time is skipped; a day already having `點心` names
      the next new snack `點心2`.
- [ ] Standard meals still one per (day, code); glucose still extracted from all items;
      existing diet tests updated for the new snack shape.

## 3. Gate
- [ ] `npm test` + `npm run typecheck` green.
