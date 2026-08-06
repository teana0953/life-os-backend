## MODIFIED Requirements

### Requirement: An expense and its shares are written atomically

Creating or editing an expense SHALL write the expense row, its share rows
and the share holders' mirrored finance transactions in a single database
statement batch, so a failure can never leave an expense whose shares do not
sum to its amount, nor a split whose mirrors disagree with it. The identifier
SHALL be generated before the write so every part of the batch can reference
it. Deleting an expense SHALL remove its mirrors.

Mirrors join this batch rather than following it because the driver has no
transaction support: a mirror written afterwards could fail on its own,
leaving a permanent disagreement between the two views that nothing would
detect or repair.

The mirror rows SHALL be determined before the write and handed to the
repository, which SHALL NOT compute them: what a mirror contains, who gets
one, and which category it lands on are decisions that SHALL be observable
without a database. An edit SHALL update a share holder's existing mirror in
place rather than replacing it, and SHALL remove the mirror of anyone who is
no longer a share holder.

#### Scenario: A failed write leaves nothing behind

- **WHEN** writing an expense's shares fails
- **THEN** no expense row remains that has no shares or mismatched shares

#### Scenario: A failed mirror leaves no split behind either

- **WHEN** writing a share holder's mirrored transaction fails
- **THEN** no expense row, share row or mirror remains from that write

#### Scenario: An edit does not replace a mirror

- **WHEN** an expense's amount is edited
- **THEN** each remaining share holder's existing mirror is updated, keeping
  anything they had personally changed on it

#### Scenario: A dropped participant loses their mirror

- **WHEN** an expense is edited so that a participant no longer holds a share
- **THEN** that participant's mirror is removed in the same write, whether or
  not the expense belongs to a group

### Requirement: Split expenses record who paid and who owes

A split expense SHALL record the amount in the currency's minor units, the
currency, a payer, a description, a day, an optional category name, and one
share row per participant holding the amount that participant owes. Each
share SHALL be returned with its participant's display name, and the expense
SHALL be returned with the payer's: a share holder can read the whole
expense, including co-participants who are neither their friend nor a member
of any group they share — the friendship rule is checked against the writer
only — so nothing else could resolve those names. The payer's name SHALL NOT
be derived from the shares, since a payer who merely fronted the money holds
none. The shares SHALL always sum exactly to the expense amount. An expense
MAY belong to a group or to none — a groupless expense is a direct split
between the people named in its shares.

The category SHALL be recorded as a name, not an identifier, because finance
categories are per-user: the payer's identifier means nothing to the other
participants, who are the ones who need to read it.

#### Scenario: An expense stores a share per participant

- **WHEN** a user records a 900 TWD expense split between three people
- **THEN** the expense holds one share per participant and those shares sum
  to exactly 900

#### Scenario: A co-participant the reader does not know is still named

- **WHEN** A records a three-way split between A, B and C, where B and C are
  each A's friend but not each other's, and B then reads the expense
- **THEN** C's share carries C's display name

#### Scenario: The payer is named even holding no share

- **WHEN** A records an expense they paid for entirely on behalf of B and C,
  taking no share themselves, and B reads it
- **THEN** the expense carries A's display name as its payer, which appears
  nowhere among the shares

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

#### Scenario: A category name is optional and stored as given

- **WHEN** an expense is recorded with a category name, and another without
- **THEN** both are created, and reading them back returns the name that was
  given and nothing for the one that had none
