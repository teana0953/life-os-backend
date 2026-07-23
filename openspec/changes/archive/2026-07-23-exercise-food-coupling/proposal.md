## Why

Feature C4 — the exercise ↔ food coupling that was chaodays' signature idea and
was deliberately deferred when exercise (A) shipped as pure logging. The daily
target already has a `bonus` (`effective = base + bonus`); nothing wrote it. This
wires exercise into it: **the more you move, the more you can eat.**

## What Changes

- **`exerciseBonusPortions(totalMinutes)`** (domain): one whole portion per 30
  minutes of a day's total exercise (a partial block earns nothing), capped at 8.
- **`applyExerciseBonus`** (use case): recomputes a day's bonus from its total
  exercise minutes and writes it to that day's daily target — **staple + meat**
  (carbohydrate + protein, following chaodays), preserving the day's base (its own
  if set, else the carried-forward base, else zero) and any hand-set fruit/veg
  bonus.
- **`POST /api/exercise`** and **`DELETE /api/exercise/:id`** call it after the
  mutation, so logging raises and deleting lowers the day's food target. To let
  DELETE know which day to recompute, `ExerciseRepository.deleteEntry` now returns
  the deleted entry's **day** (or null) instead of a boolean; the route still
  reports `{ deleted: <bool> }`.

Backend only; the food target's `effective`/`remaining` already flow to the today /
target tabs, so the bonus surfaces there with no frontend change. Gate = `npm test`
+ `npm run typecheck`.

## Capabilities

### Modified Capabilities

- `exercise-tracking`: logging or deleting exercise recomputes the day's food
  bonus (staple + meat) in the daily target, so the effective food portions rise
  and fall with the day's exercise.
