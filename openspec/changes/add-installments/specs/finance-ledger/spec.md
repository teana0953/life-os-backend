## ADDED Requirements

### Requirement: Instalment plans

A user SHALL be able to record a purchase as an instalment plan, which creates
one ordinary transaction per month, so that a month's spending counts each
instalment in the month it falls in without needing to know about plans at
all.

A plan SHALL be created either from a total to be divided across the
instalments, or from a per-instalment amount to be used as given. An amount
given per instalment SHALL be recorded unchanged.

Where a total does not divide evenly, the instalments SHALL still sum to
exactly that total.

A plan SHALL NOT record an interest rate and SHALL NOT derive any amount from
one.

#### Scenario: Each month is counted in its own month

- **WHEN** a purchase is recorded as an instalment plan
- **THEN** each instalment appears in its own month's spending, and none of the
  later months' amounts appear in the first month

#### Scenario: Creating a plan does not spend the future's budget warnings

- **WHEN** a plan spanning future months is created
- **THEN** no budget warning is raised for a month that has not arrived, and a
  warning can still be raised for those months when they do

#### Scenario: Settling early can still warn about this month

- **WHEN** settling a plan early produces a transaction large enough to cross
  a budget threshold for the current month
- **THEN** that warning is raised — suppressing warnings for everything a plan
  writes would silence the largest expense the feature can produce

#### Scenario: A per-instalment amount is used as given

- **WHEN** a plan is created from a per-instalment amount
- **THEN** every instalment is exactly that amount

#### Scenario: An uneven division still adds up

- **WHEN** a total does not divide evenly across the instalments
- **THEN** the instalments differ by at most one minor unit and their sum is
  exactly the total

#### Scenario: A month that has no such day does not shift the ones after it

- **WHEN** a plan starts on a day some later month does not have
- **THEN** that month's instalment falls on its last day, **and every later
  month's instalment is still on the plan's original day of the month** —
  the missing day is not carried forward

### Requirement: Changing and settling a plan

A user SHALL be able to change a plan's remaining instalments, and to settle a
plan early.

Changing a plan SHALL leave instalments that have already fallen due as they
are, and rewrite only those still to come, judged against the user's own
current date.

Settling early SHALL replace all instalments still to come with a single
transaction dated today. Where the plan's instalment amounts were given rather
than divided from a total, the settlement amount SHALL also be given — the
remaining instalments of such a plan include charges that settling avoids, so
their sum is not what settling costs.

An instalment SHALL otherwise behave as an ordinary transaction: editing or
deleting one SHALL NOT alter any other. Amounts owed by a plan SHALL be
computed from the instalments that exist, so that deleting one removes it from
what changing or settling the plan costs.

#### Scenario: Past instalments are left alone

- **WHEN** a plan is changed after some instalments have fallen due
- **THEN** those instalments keep their amounts and dates

#### Scenario: Settling early moves the money to today

- **WHEN** a plan whose instalments were divided from a total is settled early
- **THEN** the instalments still to come are gone and a single transaction
  dated today carries their total

#### Scenario: Settling a plan whose amounts were given does not guess

- **WHEN** a plan whose instalment amount was given is settled early
- **THEN** the settlement amount is the one supplied, not the sum of the
  remaining instalments

#### Scenario: A deleted instalment is not settled for

- **WHEN** an instalment still to come is deleted and the plan is then settled
- **THEN** the settlement covers only the instalments that remain

#### Scenario: Editing one instalment changes only that one

- **WHEN** a single instalment's amount is edited
- **THEN** no other instalment's amount changes

### Requirement: Reading a plan

A user SHALL be able to read a plan's period count, creation mode (whether its
amounts were divided from a total or given per instalment), and start month —
not merely which transactions belong to it — so that a client can render an
instalment's position ("3 of 12") and know whether settling a plan should
prompt for an amount.

#### Scenario: A plan's schedule is readable, not just its transactions

- **WHEN** a plan is read
- **THEN** its period count, creation mode, and start month are returned
  alongside the transactions it produced
