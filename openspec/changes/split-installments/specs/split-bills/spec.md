## MODIFIED Requirements

### Requirement: Balances are per currency and never converted

A balance SHALL be reported as the net of what others owe the caller minus
what the caller owes them, computed separately for each currency and never
summed across currencies. Currencies whose net is zero SHALL be omitted.
Balances SHALL be aggregated in the database rather than by loading every
share into memory.

A balance SHALL be the whole of what is owed, whether or not any of it is on a
repayment schedule. A schedule changes when money moves, not whether the debt
exists — and a balance that counted only the periods already due would report a
freshly scheduled debt as zero, which this endpoint omits entirely, making
"owes nothing" and "owes everything, none of it due yet" the same answer.

Where a debt is on a schedule, the response SHALL also carry its progress —
which period is next, of how many, and that period's amount. That is a second,
genuinely different question ("what do I hand over this month") from the one
the balance answers ("what am I out if they vanish"), and answering only one of
them leaves the other unanswerable.

Progress SHALL be reported per scheduled expense, not per counterpart: two
things split with the same person in the same currency are two schedules, and
a single combined figure belongs to neither of them.

#### Scenario: Two currencies stay on separate lines

- **WHEN** the caller and another user have both TWD and USD expenses
  between them
- **THEN** the balance with that user lists a TWD figure and a USD figure
  separately, with no combined total

#### Scenario: A settled currency disappears

- **WHEN** the net between two users in one currency reaches zero
- **THEN** that currency is not listed for that pair

#### Scenario: The payer's own share is excluded from both sides

- **WHEN** a payer includes their own share in an expense
- **THEN** their own share does not appear in what anyone owes them

#### Scenario: A group balance nets to zero across its members

- **WHEN** the balances of every member of a group are listed for one
  currency
- **THEN** they sum to zero — each member's figure is their net against the
  whole group, not a pairwise matrix

#### Scenario: Nobody owes themselves

- **WHEN** a payer holds a share in their own expense
- **THEN** no balance line is produced between that user and themselves

#### Scenario: A pure advance is owed in full

- **WHEN** a payer records an expense in which they hold no share
- **THEN** the whole amount is owed to them by the other participants

#### Scenario: A scheduled debt is owed in full from the start

- **WHEN** a share is put on a repayment schedule and nothing has been repaid
- **THEN** the balance is the whole share, and the counterpart is listed rather
  than omitted

#### Scenario: Only real repayments move the balance

- **WHEN** two of twelve scheduled periods have actually been repaid
- **THEN** the balance has fallen by those two repayments, not by the periods
  whose dates have merely passed

#### Scenario: The schedule's progress rides alongside the balance

- **WHEN** a counterpart's debt is on a schedule
- **THEN** their balance row also says which period is next, of how many, and
  what that period is worth

#### Scenario: Two schedules with the same person stay two schedules

- **WHEN** a counterpart is on two separate repayment schedules in the same
  currency
- **THEN** their balance row reports both, each with its own period count and
  period amount, rather than one row summing the periods of one and taking the
  amount of the other

