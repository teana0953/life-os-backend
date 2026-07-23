# Tasks

TDD. `npm test` + `npm run typecheck` before finishing.

- [x] 1. `domain/exercise-bonus.ts`: `exerciseBonusPortions(totalMinutes)` = one
      portion per 30 min (whole only), capped at 8; 0 for non-positive. Test first.
- [x] 2. `application/apply-exercise-bonus.ts`: recompute a day's bonus from total
      exercise minutes and write staple+meat bonus into the daily target, preserving
      base (exact → carry → 0) and hand-set fruit/veg bonus. Test first (base
      preserved, carry-forward, empty day clears).
- [x] 3. `ExerciseRepository.deleteEntry` → returns the deleted entry's `day`
      (or null); update the Drizzle adapter (`.returning({day})`), the
      delete-exercise-entry use case, and the fakes.
- [x] 4. `routes/exercise.ts`: POST + DELETE call `applyExerciseBonus`; add
      `dailyTargetRepository` to the options and wire it in `app.ts`. HTTP test:
      logging raises the bonus, more raises it, deleting lowers it.
- [x] 5. `npm test` green, `npm run typecheck` clean.
