## MODIFIED Requirements

### Requirement: An expense and its shares are written atomically

Creating or editing an expense SHALL write the expense row, its share rows,
its activity entry and the share holders' mirrored finance transactions in a
single database statement batch, so a failure can never leave an expense whose shares do not
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

The write SHALL report the mirrors **as it stored them**, which is not always
what it was given: an edit keeps the category of a mirror its owner
recategorised, so the planned row and the stored row name different
categories. Anything that runs off a mirror after the write — the budget
check below — SHALL be given the stored rows, or it would examine a category
the money is not in and never the one it is.

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
participants, who are the ones who need to read it. An empty name SHALL be
treated as none, and so SHALL an absent one. An edit is a full replacement,
not a patch — every other field it leaves out is rejected as missing — so the
category is the one optional field there, and leaving it out clears it rather
than keeping what was stored. A client that means to keep the category SHALL
resend it: leaving it out moves every share holder's mirror to their fallback
category.

Because an expense's participants each get a transaction in their own ledger,
whoever may edit or delete an expense thereby writes to, and deletes from,
other people's ledgers. That reach SHALL be limited to the mirrors of that
expense: no other row of anyone's ledger SHALL be touched.

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

- **WHEN** an expense is recorded with a category name, another with an empty
  one, and another with none at all
- **THEN** all three are created, and reading them back returns the name that
  was given and nothing for the other two

#### Scenario: An edit that leaves the category out clears it

- **WHEN** an expense recorded with a category name is edited by a request
  that does not carry one
- **THEN** the expense has no category name afterwards

#### Scenario: Deleting an expense touches only its own mirrors

- **WHEN** the payer deletes an expense and a share holder has other
  transactions that month
- **THEN** only the mirror of that expense disappears from the share holder's
  ledger

### Requirement: The split queries are proven against a real database

The queries that decide who can see a split record and how much anyone owes
SHALL be verified by executing them against a real PostgreSQL engine with the
project's own migrations applied — not against a test double. Each such test SHALL be shown to fail
when the part of the query it covers is made wrong, so that passing means the
query is right rather than that nothing was checked. A behaviour that holds
**by construction** rather than by a query — one table simply not being read
by another query — SHALL NOT be written as a test here, since no mutation
could make it fail; state it where the code is instead.

The writes that keep a share holder's mirrored transaction in step with the
split SHALL be proven the same way — the upsert that preserves a category the
user chose, the delete that removes a dropped participant's mirror, the
partial unique index that stops a second mirror appearing, and the cascade
that removes mirrors with the expense. These live in SQL, so a test driven
through an in-memory repository would only prove the fake agrees with
itself.

#### Scenario: Visibility is proven, not assumed

- **WHEN** the expense listing query runs for someone who is neither a payer,
  a share holder, nor a member of the expense's group
- **THEN** the expense is absent from the result, executed against a real
  database

#### Scenario: A repayment moves the balance in the proven direction

- **WHEN** someone owes 450 and repays 300, and the balance query is executed
  against a real database
- **THEN** the remaining balance is 150 — and reversing the settlement's sign
  in the query makes this fail

#### Scenario: The payer's own share is treated oppositely in the two queries

- **WHEN** a payer holds a share in their own expense
- **THEN** the balance query excludes it while the split-spending query
  includes it, both executed against a real database

#### Scenario: Currencies are never combined

- **WHEN** a pair has balances in two currencies and settles one
- **THEN** only that currency changes, executed against a real database

#### Scenario: An edit keeps a user's own category, proven against SQL

- **WHEN** a share holder has recategorised their mirror and the expense's
  amount is then edited, executed against a real database
- **THEN** the mirror's amount changes and its category does not — and making
  the update overwrite the category unconditionally makes this fail

#### Scenario: A dropped participant's mirror is removed, proven against SQL

- **WHEN** an expense in a group is edited so a participant no longer holds a
  share, executed against a real database
- **THEN** their mirror is gone — and removing the delete from the write makes
  this fail

#### Scenario: A second mirror cannot appear

- **WHEN** the same expense is edited twice, executed against a real database
- **THEN** each share holder still has exactly one mirror, carrying the second
  edit's amount — and writing the mirrors as a plain insert instead of an
  upsert makes this fail. Dropping the index alone is not that mutation: the
  `ON CONFLICT` target then matches no unique constraint and every mirror
  write fails in the planner, which shows the index exists rather than that it
  is the right index.

#### Scenario: A write hands back the mirrors it stored

- **WHEN** a share holder has recategorised their mirror and the expense is
  edited, executed against a real database
- **THEN** the write reports that holder's mirror on the category it is
  stored in, not the one the edit planned — the categories the budget checks
  below run on

