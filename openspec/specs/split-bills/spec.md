# split-bills Specification

## Purpose
TBD - created by archiving change add-split-bills. Update Purpose after archive.
## Requirements
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

### Requirement: Equal splits divide the remainder deterministically

An equal split SHALL divide the amount into whole minor units with no
floating-point arithmetic, and SHALL assign the remainder one unit at a time
to participants ordered by their lowercase canonical UUID. The same
participants and amount SHALL therefore always produce the same split.

#### Scenario: A remainder is distributed, not lost or rounded

- **WHEN** 100 is split equally between three participants
- **THEN** the shares are 34, 33 and 33 — summing to exactly 100

#### Scenario: The same split is reproducible

- **WHEN** the same amount is split equally between the same participants
  twice
- **THEN** each participant receives the identical share both times

### Requirement: Exact splits are validated, never adjusted

An exact split SHALL take each participant's amount from the caller. The
server SHALL verify that every share is non-negative and that they sum to the
expense amount, and SHALL reject anything else rather than silently adjusting
a share to make the total work.

#### Scenario: A short exact split is rejected, not topped up

- **WHEN** an exact split's shares sum to less than the expense amount
- **THEN** the request is rejected with `400` and no expense is created

#### Scenario: A negative share is rejected

- **WHEN** an exact split includes a negative share
- **THEN** the request is rejected with `400`

### Requirement: Stored shares are never recomputed on read

The shares SHALL be persisted at write time and returned as stored. Reading
an expense SHALL NOT re-derive its shares from the split mode, so a change to
the splitting algorithm can never alter a historical expense.

#### Scenario: A stored expense keeps its original shares

- **WHEN** an expense's shares are read back after being created
- **THEN** the amounts are exactly those written, independent of the split
  mode recorded alongside them

### Requirement: You cannot record an expense you are not part of

The caller SHALL have a stake in any expense they create: they SHALL be the
payer, or hold a share greater than zero. Merely appearing among the shares
for an amount of `0` SHALL NOT count, since it leaves the caller owing and
owed nothing. A zero share for another participant SHALL remain legal — a
person who genuinely owes nothing on a shared bill is a real case, and it
cannot fabricate anything while the caller's own stake is required. The payer
SHALL be validated like any other named user, not accepted as an opaque
field, because the payer determines which direction the money is owed.

#### Scenario: A debt between two other people cannot be fabricated

- **WHEN** a user submits an expense naming someone else as payer and a third
  person as the only share holder, with themselves nowhere in it
- **THEN** the request is rejected with `400` and no expense is created

#### Scenario: A zero share for the caller is not a stake

- **WHEN** a user submits an expense naming someone else as payer, a third
  person owing the whole amount, and themselves holding a share of `0`
- **THEN** the request is rejected with `400` and no expense is created — the
  stored result would be a debt between two other people with the caller
  economically absent

#### Scenario: A zero share for another participant is allowed

- **WHEN** an expense in which the caller holds a share names another
  participant with a share of `0`
- **THEN** the expense is created — that participant simply owes nothing for
  this bill

#### Scenario: The payer must be someone the caller knows

- **WHEN** an expense names a payer who is neither the caller, a friend of
  the caller, nor a member of the expense's group
- **THEN** the request is rejected with `400`

#### Scenario: A group expense must be paid by a group member

- **WHEN** a grouped expense names a payer who is a friend of the caller but
  not a member of that group
- **THEN** the request is rejected with `400` — otherwise a member ends up
  owing someone outside the group, and that credit never appears in the
  group's balances

### Requirement: Only participants can see an expense

An expense SHALL be visible only to its payer and the users holding a share
in it, or — for a grouped expense — to that group's members. Any other
caller SHALL receive `404`, never `403`, so nothing reveals that the expense
exists.

#### Scenario: A stranger cannot read an expense

- **WHEN** a user who is neither the payer, a participant, nor a group member
  requests an expense by id
- **THEN** the response is `404`

#### Scenario: A participant can read an expense they did not create

- **WHEN** a user holding a share requests the expense
- **THEN** the expense and all of its shares are returned

### Requirement: Only the creator or the payer can change an expense

An expense SHALL be editable and deletable only by the user who created it or
the user who paid. Other participants SHALL receive `404`. Editing an
expense SHALL replace its shares atomically, so a participant removed from
the split stops owing immediately.

#### Scenario: A participant cannot edit an expense

- **WHEN** a participant who is neither the creator nor the payer tries to
  edit or delete the expense
- **THEN** the response is `404` and the expense is unchanged

#### Scenario: The payer can edit an expense someone else created

- **WHEN** the payer edits an expense created by another participant
- **THEN** the edit succeeds

#### Scenario: Editing re-runs every creation rule

- **WHEN** an expense is edited so that its shares no longer sum to the
  amount, or so that a share names someone who is not a friend or group
  member
- **THEN** the request is rejected with `400` and the stored expense is
  unchanged — editing SHALL NOT be a path around the rules that govern
  creation

#### Scenario: Editing cannot remove the editor from the expense

- **WHEN** the creator edits an expense so that they are neither the payer
  nor the holder of a share greater than zero — whether by dropping their
  share or by setting it to `0`
- **THEN** the request is rejected with `400` — otherwise a user could
  create a legitimate expense and then edit it into a debt between two other
  people, which they could not have created directly

#### Scenario: An expense cannot be moved between groups

- **WHEN** an edit changes the expense's group
- **THEN** the request is rejected — moving an expense hands it to a
  different set of people, which is a new expense, not an edit

#### Scenario: Removing a participant clears what they owed

- **WHEN** an expense is edited so that a former participant no longer holds
  a share
- **THEN** that user no longer owes anything for that expense, and the
  remaining shares still sum to the amount

### Requirement: You can only split with people you know

Every user named in an expense — payer and share holders alike — SHALL be a
member of that expense's group when it has one, and the caller
themselves or a friend of the caller when it does not. A share naming anyone else SHALL be rejected
with `400`, since the caller supplied that id and no existence is being
disclosed. An expense referring to a group the caller does not belong to
SHALL answer `404`.

#### Scenario: A non-friend cannot be charged

- **WHEN** an expense is submitted with a share belonging to a user who is
  not the caller's friend and not a member of the expense's group
- **THEN** the request is rejected with `400` and no expense is created

#### Scenario: A group the caller does not belong to is not found

- **WHEN** an expense names a group the caller is not a member of
- **THEN** the response is `404`

#### Scenario: A group expense cannot charge a non-member

- **WHEN** a grouped expense includes a share for someone outside that group
- **THEN** the request is rejected with `400`

### Requirement: Groups collect members who are already friends

A group SHALL be created with its creator as the first member. A member MAY
add another user only if that user is already their friend. Group details and
membership SHALL be visible only to members; anyone else receives `404`.
Every member SHALL be returned with a display name, so a client never has to
render a bare identifier — including a member whose balance nets to zero and
who therefore appears in no balance listing. The group listing SHALL carry
each group's members, resolved in a single lookup rather than one per group.

#### Scenario: The creator is a member

- **WHEN** a user creates a group
- **THEN** they are listed as a member of it

#### Scenario: A member adds a friend

- **WHEN** a member adds a user who is their friend
- **THEN** that user becomes a member

#### Scenario: A stranger cannot be added

- **WHEN** a member tries to add a user who is not their friend
- **THEN** the request is rejected with `400`

#### Scenario: Adding an existing member is a bad request

- **WHEN** a member adds a user who is already a member of that group
- **THEN** the request is rejected with `400`, not `500`, and the membership
  is unchanged

#### Scenario: A non-member cannot read the group

- **WHEN** a user who is not a member requests the group
- **THEN** the response is `404`

#### Scenario: Members carry their names

- **WHEN** a member reads a group's details or lists their groups
- **THEN** every member is returned with a display name, including one whose
  balance is settled

#### Scenario: Names cost one lookup, not one per group

- **WHEN** a caller lists several groups
- **THEN** the members of all of them are resolved in a single lookup

### Requirement: Archiving a group keeps its history readable

Deleting a group SHALL archive it rather than remove it, because its expenses
are other people's financial history. An archived group and its expenses
SHALL remain readable by its members, and SHALL reject new expenses. Only
the creator SHALL be able to archive it.

#### Scenario: Archiving preserves the expenses

- **WHEN** a group is archived
- **THEN** its members can still read the group and its expenses

#### Scenario: An archived group takes no new expenses or members

- **WHEN** an expense is submitted for an archived group, or a member is
  added to it
- **THEN** the request is rejected

#### Scenario: Existing expenses stay correctable after archiving

- **WHEN** the creator or payer edits or deletes an expense belonging to an
  archived group
- **THEN** the change succeeds — archiving SHALL NOT freeze a wrong amount in
  place with no way to fix the balance

#### Scenario: A member who did not create the group cannot archive it

- **WHEN** a member other than the creator tries to archive the group
- **THEN** the response is `404` and the group is unchanged

### Requirement: Balances are per currency and never converted

A balance SHALL be reported as the net of what others owe the caller minus
what the caller owes them, computed separately for each currency and never
summed across currencies. Currencies whose net is zero SHALL be omitted.
Balances SHALL be aggregated in the database rather than by loading every
share into memory.

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

### Requirement: Listing expenses is scoped and unambiguous

Listing SHALL return only expenses the caller participates in, filtered in
the database rather than after loading. Participation SHALL mean the same
thing in every listing: the payer, a share holder, or — for a grouped
expense — a member of that group, so an unfiltered listing and a `group_id`
listing never disagree about what the caller can see. `with=<userId>` SHALL mean the
groupless expenses in which both the caller and that user participate, so
group expenses never appear in a one-to-one list. Supplying both `group_id`
and `with` SHALL be rejected as ambiguous.

#### Scenario: A non-participant's expense never reaches the caller

- **WHEN** the expense store returns a row the caller does not participate in
- **THEN** it is not included in the listing — participation is enforced
  above the query as well as inside it, so a mistake in the query alone
  cannot leak other users' expenses

#### Scenario: An unfiltered list includes group expenses seen through membership

- **WHEN** a group member who holds no share in one of the group's expenses
  lists their expenses with no filter
- **THEN** that expense is returned, the same as it would be under
  `group_id=<that group>`

#### Scenario: A one-to-one list excludes group expenses

- **WHEN** the caller lists expenses `with` a user they share both a group
  and a direct expense with
- **THEN** only the groupless expense is returned

#### Scenario: Conflicting filters are rejected

- **WHEN** both `group_id` and `with` are supplied
- **THEN** the request is rejected with `400`

### Requirement: Malformed identifiers do not reach the database

An identifier that is not a UUID SHALL be rejected before any query runs: an
invalid path parameter SHALL answer `404` and an invalid identifier in a
request body SHALL answer `400`. Neither SHALL surface as a server error.

#### Scenario: A malformed path id is not found

- **WHEN** a request targets an expense or group whose id is not a UUID
- **THEN** the response is `404`, not `500`

#### Scenario: A malformed participant id is a bad request

- **WHEN** a share names a user id that is not a UUID
- **THEN** the response is `400`, not `500`

### Requirement: Split input is validated

Amounts SHALL be integers in the currency's minor units, supplied as JSON
numbers, currencies SHALL be three uppercase letters, and days SHALL be
`YYYY-MM-DD`. Anything else SHALL be rejected with `400`, including a numeric
string, which SHALL NOT be coerced into a money value.

#### Scenario: A numeric string amount is rejected, not coerced

- **WHEN** an expense or a share is submitted with an amount of `"100"`
  rather than `100`
- **THEN** the request is rejected with `400`

#### Scenario: A malformed currency is rejected

- **WHEN** an expense is submitted with a currency that is not three
  uppercase letters
- **THEN** the request is rejected with `400`

#### Scenario: An amount too large for storage is a bad request

- **WHEN** an expense is submitted with an amount above what the amount
  column can hold
- **THEN** the request is rejected with `400`, not reported as a server error

#### Scenario: An equal split too small to go round is rejected clearly

- **WHEN** an equal split's amount is smaller than the number of
  participants, so someone would receive nothing
- **THEN** the request is rejected with `400` and the message says the amount
  is too small — not that the caller is not a participant — and it is
  rejected identically whoever submits it

#### Scenario: A malformed day is rejected

- **WHEN** an expense is submitted with a day that is not `YYYY-MM-DD`
- **THEN** the request is rejected with `400`

### Requirement: Settlements record a repayment as itself

A repayment SHALL be recorded as its own kind of record — who paid whom, how
much, in which currency, on which day, optionally within a group and with a
note — never as a reversed expense. The amount SHALL be a positive integer in
the currency's minor units, and the payer and payee SHALL be different people.

#### Scenario: A repayment is recorded

- **WHEN** a user records paying 450 TWD to a friend they owe
- **THEN** a settlement exists naming both of them, the amount, the currency
  and the day

#### Scenario: Paying yourself is rejected

- **WHEN** a settlement names the same user as payer and payee
- **THEN** the request is rejected with `400`

#### Scenario: A non-positive or oversized amount is rejected

- **WHEN** a settlement is submitted with an amount of `0` or less, or above
  what the amount column can hold
- **THEN** the request is rejected with `400`, never as a server error

#### Scenario: Repayments are not edited in place

- **WHEN** a user needs to correct a repayment
- **THEN** they delete it and record it again — there is no partial update
  path that could skip the creation rules

### Requirement: Settlements reduce what is owed, in the right direction

A balance SHALL net settlements against split shares — refining the
definition of a balance as the net of shares alone — in the direction that
reduces what is actually owed. A personal balance counts **every** settlement
between the pair whether or not it names a group, matching the fact that it
already counts every expense between them; a group balance counts only that
group's settlements. A personal balance is reported about the other
person, so being repaid by them SHALL reduce it. A group balance is reported
about each member, so a member repaying someone SHALL move their own figure
toward zero. Group balances SHALL still sum to zero per currency, but that
sum SHALL NOT be relied on as the check that the direction is right — it
holds under either sign convention — so the direction SHALL be pinned by
asserting the signed figure of a named person.

#### Scenario: Being repaid reduces what they owe

- **WHEN** someone owes the caller 450 TWD and repays 450 TWD
- **THEN** the balance between them in TWD is settled and no longer listed

#### Scenario: Repaying reduces what the caller owes

- **WHEN** the caller owes 450 TWD and repays 300 TWD
- **THEN** the caller now owes 150 TWD — not 750

#### Scenario: Overpaying flips the balance

- **WHEN** the caller owes 450 TWD and repays 600 TWD
- **THEN** the balance shows the other person owing the caller 150 TWD —
  overpaying is a real situation and is not refused

#### Scenario: A repaying group member moves toward zero, by name

- **WHEN** group member B owes 450 TWD and repays 300 TWD to A
- **THEN** B's group figure is −150 and A's is +150 — asserted per member and
  signed, not merely summing to zero, which would pass with the signs swapped

#### Scenario: A group still nets to zero after a repayment

- **WHEN** one group member repays another and the group's balances are
  listed for that currency
- **THEN** they still sum to zero — a sanity check, not the direction check

#### Scenario: A group settlement also settles the pairwise balance

- **WHEN** two people who are both group members settle a debt with the
  group named
- **THEN** both the group balance and their personal balance with each other
  reflect it

#### Scenario: Currencies stay apart

- **WHEN** a repayment is made in one currency between two people who also
  have expenses in another
- **THEN** only that currency's balance changes

### Requirement: Settlements follow the same authorization rules as expenses

Creating a settlement SHALL require the caller to be its payer or its payee,
and the other party to be a friend of the caller **or someone they share a
group with** — deliberately looser than creating a groupless expense, which
requires friendship, because a debt can arise purely through a shared group
between two people who never became friends and refusing to settle it would
leave that balance with no way to clear it. Within a group, the other party
must be a member of it; a grouped settlement SHALL involve only members of that group.
A settlement SHALL be visible only to its payer, its payee, or the members of
its group, and SHALL be deletable only by the user who created it or the one
who paid. Every other caller SHALL receive `404`, never `403`.

#### Scenario: A repayment between two other people cannot be recorded

- **WHEN** a user records a settlement naming two other people, with
  themselves as neither payer nor payee
- **THEN** the request is rejected with `400`

#### Scenario: A stranger's listing never contains the settlement

- **WHEN** a user who is neither party nor a member of its group lists
  settlements — unfiltered, or filtered to a group they do not belong to
- **THEN** the settlement is absent, and the group filter answers `404`

#### Scenario: A payee cannot delete a settlement

- **WHEN** the payee, who did not create it, tries to delete a settlement
- **THEN** the response is `404` and the settlement is unchanged

#### Scenario: A non-friend cannot be settled with

- **WHEN** a settlement names someone who is neither a friend of the caller
  nor a member of its group
- **THEN** the request is rejected with `400`

#### Scenario: Malformed identifiers do not reach the database

- **WHEN** a settlement is requested with a path id that is not a UUID, or
  submitted with a body id that is not a UUID
- **THEN** the response is `404` or `400` respectively, never `500`

#### Scenario: A group co-member who is not a friend can be settled with

- **WHEN** two people share a group but are not friends, and one records a
  person-to-person repayment to the other
- **THEN** it is accepted — they still could not create a groupless expense
  together, only settle a debt they already have

### Requirement: An archived group takes no new settlements but keeps them correctable

An archived group SHALL refuse new settlements, for the same reason it
refuses new expenses, while its existing settlements SHALL remain readable
and deletable — so a mistaken repayment is never frozen in place.

#### Scenario: An archived group refuses a new repayment

- **WHEN** a settlement is submitted for an archived group
- **THEN** the request is rejected

#### Scenario: An existing repayment in an archived group can still be removed

- **WHEN** the creator deletes a settlement belonging to an archived group
- **THEN** it is deleted and the balances update

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

