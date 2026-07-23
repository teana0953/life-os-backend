## ADDED Requirements

### Requirement: Exercise raises the day's food bonus

Logging or deleting an exercise entry SHALL recompute that day's food-portion bonus in the daily target from the day's total exercise minutes: one whole portion per 30 minutes (a partial block earns nothing), capped at 8, applied to both the staple and meat categories. The recompute SHALL preserve the day's base target (its own if set, otherwise the most recent carried-forward base, otherwise zero) and any hand-set fruit/veg bonus, so `effective = base + bonus` (and remaining) reflect the exercise.

#### Scenario: Logging exercise raises the bonus
- **WHEN** a user logs 60 minutes of exercise on a day
- **THEN** that day's target has a staple bonus and a meat bonus of 2, and the base is unchanged

#### Scenario: More exercise raises it further
- **WHEN** the same day accumulates 90 minutes total
- **THEN** the staple and meat bonus is 3

#### Scenario: Deleting exercise lowers the bonus
- **WHEN** an entry is deleted so the day's total drops back to 60 minutes
- **THEN** the staple and meat bonus returns to 2

#### Scenario: A day with no exercise has no bonus
- **WHEN** a day has no exercise entries
- **THEN** its staple and meat bonus is 0
