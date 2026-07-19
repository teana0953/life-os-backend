## MODIFIED Requirements

### Requirement: Daily portion target

The system SHALL let a user hold, per day, per-category base portion goals
`{ staple, meat, fruit, veg }` plus a reserved additive `bonus` contribution
(default 0) representing future exercise-earned portions.

When a day has its own set target, the effective target for a category SHALL be
that day's `base + bonus`. When a day has **no** set target of its own, its base
SHALL carry forward from the most recent target the user set on or before that
day, and its `bonus` SHALL be 0; when the user has never set any target, the
base and bonus SHALL both be 0. Setting a target for a specific day (including a
target with all-zero base) overrides carry-forward for that day.

The system SHALL report, per category, the remaining portions as
`effective_target − sum(logged portions)`.

#### Scenario: Remaining portions
- **WHEN** a day has an effective staple target of 12 and logged entries totaling 9 staple portions
- **THEN** the system reports 3 staple portions remaining

#### Scenario: Bonus adds to base
- **WHEN** a day's base staple goal is 12 and its bonus is 2
- **THEN** the effective staple target is 14

#### Scenario: Untouched day carries forward the last set base
- **WHEN** a user set a staple base of 12 on 2026-07-01 and has set no target on 2026-07-02
- **THEN** 2026-07-02 reports a staple base of 12 with a bonus of 0

#### Scenario: Carry-forward does not carry the source day's bonus
- **WHEN** a user set a staple base of 12 with bonus 3 on 2026-07-01 and has set no target on the later day 2026-07-02
- **THEN** 2026-07-02 reports a staple base of 12 with a bonus of 0

#### Scenario: Never-set target reports zero
- **WHEN** a user has never set any daily target
- **THEN** the queried day reports an all-zero base, bonus, and effective target
