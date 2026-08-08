# split-bills Specification

## ADDED Requirements

### Requirement: An edit entry says what the edit touched

An entry recording an edit to an expense SHALL carry which of its parts
changed, drawn from a fixed vocabulary the database enforces. Carrying only
the amount meant every edit that left the amount alone rendered as "someone
modified this" with both amounts identical — a line that reads as nothing
having happened, while what changed may have been what somebody owes.

A change to the split SHALL be reported whether people joined or left it or
the same people's shares merely moved between them. A reshuffle adds nobody
and removes nobody and can leave the total untouched, so the participant sets
alone would call it no change at all.

An entry SHALL name who joined and who left the split, as the names they had
at the time rather than as references to rows that may be gone — the person
dropped from a shared expense is the reader whose balance just moved without
being told.

An edit that changed nothing SHALL say so, and SHALL stay distinguishable from
an entry that is not an edit at all. The update endpoint replaces the whole
record, so a client re-sending identical values is an ordinary event.

The vocabulary SHALL be enforced where the entry is stored, and the edit
detail SHALL be absent from entries that are not edits. A misspelled field
name is a change the reader is never told about, and it would otherwise be
written happily and surface only as a blank line.

#### Scenario: Someone is dropped from a split

- **WHEN** an expense is edited so that one participant no longer holds a share
- **THEN** the entry names that person, by the name they had, and says the
  split changed

#### Scenario: The same people, different shares

- **WHEN** an expense's total is unchanged but its shares are redistributed
  between the same participants
- **THEN** the entry says the split changed, and names nobody as joining or
  leaving

#### Scenario: An edit that touched one plain field

- **WHEN** only an expense's description, date, payer or currency is changed
- **THEN** the entry names that field and no other

#### Scenario: An edit that changed nothing

- **WHEN** an expense is saved with values identical to the ones it already had
- **THEN** the entry reports an empty set of changes, which is distinguishable
  from the absence of the field on entries that are not edits

#### Scenario: A grouped expense's split change is reported too

- **WHEN** a grouped expense's participants change
- **THEN** the entry names who joined and left, the same as for a groupless one

#### Scenario: The store refuses a field name it does not know

- **WHEN** an entry is written naming a change outside the vocabulary
- **THEN** the write is rejected rather than stored as a change nothing renders
