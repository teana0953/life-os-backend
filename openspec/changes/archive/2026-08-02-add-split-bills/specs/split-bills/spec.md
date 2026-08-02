## ADDED Requirements

### Requirement: Split expenses record who paid and who owes

A split expense SHALL record the amount in the currency's minor units, the
currency, a payer, a description, a day, and one share row per participant
holding the amount that participant owes. The shares SHALL always sum exactly
to the expense amount. An expense MAY belong to a group or to none — a
groupless expense is a direct split between the people named in its shares.

#### Scenario: An expense stores a share per participant

- **WHEN** a user records a 900 TWD expense split between three people
- **THEN** the expense holds one share per participant and those shares sum
  to exactly 900

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
add another user only if that user is already their friend. Adding someone
who is already a member SHALL be rejected with `400` rather than surfacing
the unique-constraint violation as a server error. Group details and
membership SHALL be visible only to members; anyone else receives `404`.

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

Creating or editing an expense SHALL write the expense row and its share rows
in a single database statement batch, so a failure can never leave an expense
whose shares do not sum to its amount. The identifier SHALL be generated
before the write so both parts of the batch can reference it.

#### Scenario: A failed write leaves nothing behind

- **WHEN** writing an expense's shares fails
- **THEN** no expense row remains that has no shares or mismatched shares

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
