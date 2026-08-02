## MODIFIED Requirements

### Requirement: Split expenses record who paid and who owes

A split expense SHALL record the amount in the currency's minor units, the
currency, a payer, a description, a day, and one share row per participant
holding the amount that participant owes. Each share SHALL be returned with
its participant's display name: a share holder can read the whole expense,
including co-participants who are neither their friend nor a member of any
group they share — the friendship rule is checked against the writer only —
so nothing else could resolve those names. The shares SHALL always sum
exactly to the expense amount. An expense MAY belong to a group or to none —
a groupless expense is a direct split between the people named in its shares.

#### Scenario: An expense stores a share per participant

- **WHEN** a user records a 900 TWD expense split between three people
- **THEN** the expense holds one share per participant and those shares sum
  to exactly 900

#### Scenario: A co-participant the reader does not know is still named

- **WHEN** A records a three-way split between A, B and C, where B and C are
  each A's friend but not each other's, and B then reads the expense
- **THEN** C's share carries C's display name

#### Scenario: An expense without a group is allowed

- **WHEN** a user records an expense naming only themselves and one friend,
  with no group
- **THEN** the expense is created and appears for both of them

#### Scenario: Shares that do not sum to the amount are rejected

- **WHEN** an expense of 900 is submitted with shares summing to 800
- **THEN** the request is rejected with `400` and the message states the
  discrepancy

#### Scenario: A negative or zero amount is rejected

- **WHEN** an expense is submitted with an amount of `0` or less
- **THEN** the request is rejected with `400`

#### Scenario: An expense must involve more than one person

- **WHEN** an expense is submitted whose only share belongs to the caller
- **THEN** the request is rejected with `400` — a one-person expense is
  personal bookkeeping, not a split

#### Scenario: A duplicated participant is rejected

- **WHEN** an expense is submitted listing the same user twice in its shares
- **THEN** the request is rejected with `400`
