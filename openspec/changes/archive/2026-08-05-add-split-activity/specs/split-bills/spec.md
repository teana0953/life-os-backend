## ADDED Requirements

### Requirement: Split activity record

The system SHALL record an activity entry for every change to a split expense,
settlement, or group, so that a participant can see changes made by others —
including changes that leave nothing behind, such as a deletion.

An activity entry SHALL be written in the same batch as the change it records,
and an entry for a deletion SHALL be conditional on that deletion actually
matching a row, so the timeline can neither miss a change that happened nor
show a change that did not.

An activity entry about a change with no group SHALL carry its own record of
who may see it, fixed when the entry is written, because the rows that would
otherwise identify the audience (an expense's shares) are removed when the
recorded change is a deletion. An entry about a group change SHALL instead be
shown to the group's current members, matching how the rest of the product
decides who belongs to a group.

An entry recording a change to who participates SHALL be visible to everyone
who participated before or after it, so that someone removed from a shared
expense learns of it.

An activity entry SHALL carry its own copy of what it needs to be displayed
(amount, currency, description, group name, counterpart name), so an entry
about a deleted record stays readable after that record is gone. An entry
therefore reflects the state at the time of the change, not the current state.

An entry recording an edit to an expense SHALL carry both the amount before
the edit and the amount after it, whether or not the amount changed — so that
the reader compares them, rather than reading the presence of a previous
amount as a claim that it moved.

An entry recording a repayment SHALL carry its direction — which of the two
people paid the other — because the parties and the amount alone are the same
whichever way the money went, and once the repayment is deleted nothing else
records it.

An entry recording that a group was archived SHALL be written only by the
archiving that actually took effect: archiving is one-way, so a repeated
request SHALL change nothing and record nothing.

#### Scenario: A repayment says who paid whom, and still does once deleted

- **WHEN** a repayment is recorded, and later deleted
- **THEN** both entries say which of the two people paid the other — including
  the deletion entry, written when the repayment itself is already gone

#### Scenario: An edit that left the amount alone still carries both amounts

- **WHEN** an expense is edited without changing its amount
- **THEN** the entry still carries the previous amount, equal to the new one

#### Scenario: Archiving a group twice records it once

- **WHEN** an already-archived group is archived again
- **THEN** no second entry is written and the group keeps the time it was
  first archived

#### Scenario: A deletion is still visible afterwards

- **WHEN** an expense is deleted
- **THEN** the timeline shows who deleted it, and still shows the deleted
  expense's amount and description

#### Scenario: An edit says what changed

- **WHEN** an expense's amount is changed
- **THEN** the timeline entry carries both the previous and the new amount

#### Scenario: A delete that matches no row records nothing

- **WHEN** a delete statement runs against a record that is already gone
- **THEN** no activity entry is written — the entry's existence depends on the
  delete matching a row, not on a separate check made before it

#### Scenario: Two concurrent deletes record one deletion, not two

- **WHEN** two requests delete the same expense, repayment or group at the same
  moment
- **THEN** only the one whose delete or archive actually matched a row records
  an entry — the entry-writing statement locks the row it is about, so the
  loser cannot commit an entry for a change it did not make and then report a
  404 for it
- **AND** this rests on the row lock plus PostgreSQL's READ COMMITTED re-check:
  the test suite runs on a single-connection engine and can assert only that
  the emitted SQL takes the lock, never that two such transactions interleave
  correctly

#### Scenario: The audience of a deleted record survives it

- **WHEN** an expense with no group is deleted
- **THEN** its participants still see the entry, and a non-participant still
  does not — even though the rows naming those participants are gone

### Requirement: Split activity visibility

The system SHALL show an activity entry only to the people the recorded change
affects: every member of the group for a group change, and the participants for
a change with no group.

#### Scenario: Someone removed from an expense still learns of it

- **WHEN** an expense with no group is edited so that a participant no longer
  has a share
- **THEN** that person still sees the entry recording the edit

#### Scenario: A member who joins later sees the group's earlier activity

- **WHEN** a user is added to a group that already has activity
- **THEN** their timeline includes that earlier group activity

#### Scenario: A group member sees group activity

- **WHEN** a member of a group requests their timeline
- **THEN** it includes activity for that group's expenses and settlements

#### Scenario: A non-participant sees nothing

- **WHEN** a user who is neither a group member nor a participant requests
  their timeline
- **THEN** it contains no entry for that change

#### Scenario: A groupless expense reaches its participants only

- **WHEN** an expense with no group is recorded between two people
- **THEN** both of them see it and nobody else does
