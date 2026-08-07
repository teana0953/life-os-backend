## MODIFIED Requirements

### Requirement: A split share becomes a transaction in the holder's ledger

A split expense SHALL create one finance transaction per share holder, for
that holder's own share, in the same atomic write as the split expense
itself — so the money is visible where personal spending is aggregated: the
ledger listing, the monthly summary, budgets and budget alerts. Net worth and
its trend read different tables and SHALL be unaffected.

A mirrored transaction SHALL carry the split expense it came from. Its
`amount`, `date`, `currency` and `type` SHALL NOT be editable through the
finance API — `type` above all, since flipping an expense to income removes
it from every budget and every expense total while the split still says the
money is owed — and it SHALL NOT be deletable there: those are facts of the split, and
changing them in one place only would make the two views disagree. Its
`category_id` and `note` SHALL be editable, and once edited SHALL NOT be
overwritten by later edits to the split.

An edit to a mirrored transaction SHALL be written only while those locked
fields still hold the values the request was checked against. If the split
changed in the meantime, the edit SHALL be refused with a conflict the caller
can retry after re-reading, rather than applied — applying it would put the
stale values back and leave the ledger and the split disagreeing permanently,
with no error, through the one edit this API allows.

A split expense SHALL carry an optional category name. The mirrored
transaction's category SHALL be the share holder's own **expense** category of
that name, falling back to their 其他 expense category — for an unnamed
category as well as an unmatched one — and re-seeding their defaults when that 其他
category is missing — which happens when they have none at all and equally
when they renamed it, since categories can be renamed and are never deleted. A
mirrored transaction MAY land on an archived category, unlike a
user-created one, because the mirror is not a choice and refusing it would
drop a real expense.

The payer SHALL be mirrored only for their own share; fronting money for
others is not spending. A repayment SHALL NOT be mirrored — with one
exception, below, where the repayment schedule is mirrored *instead of* the
share, never as well as it. A zero share SHALL
NOT be mirrored: owing nothing is not spending, and a finance transaction's
amount must be positive.

Writing the mirrors SHALL trigger each share holder's budget-alert check, on
the same best-effort terms as a transaction they wrote themselves: a failing
check or push SHALL NOT fail the split write.

A split expense in a currency outside the finance whitelist SHALL NOT be
mirrored, because a transaction cannot hold it. The system SHALL still
report, per month and per currency, what the user personally owed on split
expenses, and SHALL mark each currency as to whether it is already counted in
the user's transactions, so that a caller can neither double-count a mirrored
currency nor silently lose an unmirrored one.

A shared expense MAY carry a repayment schedule: a period count and a per-period
amount that the share holders pay the payer over time, rather than at once.
When a share is repaid on a schedule, that holder's ledger SHALL receive one
transaction per period instead of a single transaction for the whole share,
because each period is what they actually pay that month.

This is an exception to "a repayment is not mirrored", and it SHALL remain an
exclusive one: the schedule replaces the lump mirror, never joins it. Writing
both would record the same money twice — a 6,000 share plus twelve 500s is
18,000 of spending for 6,000 of expense.

What is owed SHALL NOT change because of a schedule. A schedule says when the
money moves, not whether the debt exists; the debt is whole from the moment the
payer paid. A balance that counted only the periods already due would report a
brand-new plan as nothing owed at all, since a zero balance is reported as an
absent one — indistinguishable from a settled debt.

Scheduled periods SHALL NOT be recorded as repayments. A period is a plan to
pay; a repayment is a payment. Only the latter reduces what is owed.

#### Scenario: A user's own shares are summed per currency

- **WHEN** the user holds a 300 TWD share and a 1000 USD share on split
  expenses in a month
- **THEN** the report shows 300 for TWD and 1000 for USD, as separate rows
  never combined

#### Scenario: The payer's own share counts as their spending

- **WHEN** the user paid for a split and holds a share in it
- **THEN** their share is included in that month's split spending

#### Scenario: A repayment is not spending

- **WHEN** the user repays a friend during the month
- **THEN** the split-spending figure is unchanged, and no transaction is
  created for the repayment

#### Scenario: Every share holder gets a transaction

- **WHEN** a split expense in a whitelisted currency is recorded
- **THEN** each share holder has a transaction for their own share, and
  deleting the split expense removes those transactions with no leftover
  record

#### Scenario: A month with no splits reports nothing

- **WHEN** the user has no split shares in the month
- **THEN** the report is empty rather than a zero row per currency

#### Scenario: A shared meal reaches the ledger, the summary and the budget

- **WHEN** a 1800 TWD dinner is split evenly between two people
- **THEN** each of them has a 900 TWD expense transaction in their ledger,
  their monthly summary expense total includes it, and it consumes both the
  overall and the chosen category's budget

#### Scenario: A share can cross a budget threshold and notify

- **WHEN** a share pushes a holder's monthly spending past 80% of a budget
- **THEN** that holder is notified, once, exactly as if they had recorded the
  expense themselves

#### Scenario: A split write survives a failing alert

- **WHEN** the budget-alert check or its push delivery throws while a split is
  being recorded
- **THEN** the split expense, its shares and its mirrors are all stored and
  the API responds success

#### Scenario: A zero share gets no transaction

- **WHEN** a participant's share on a split is zero
- **THEN** no transaction is created for them

#### Scenario: An expense category is chosen, never an income one

- **WHEN** the split names a category whose name exists for the share holder
  as both an expense and an income category
- **THEN** the mirrored transaction uses the expense one

#### Scenario: Editing the split moves both mirrors

- **WHEN** the payer changes the dinner's amount, date or participants
- **THEN** every affected share holder's mirrored transaction changes with
  it, and a share holder who was removed no longer has one

#### Scenario: An untouched mirror follows the split's category

- **WHEN** a split names 餐飲, the payer later changes it to 娛樂, and the
  share holder never recategorised their mirror
- **THEN** the mirror's category becomes 娛樂

#### Scenario: A hand-picked category survives the next split edit

- **WHEN** a share holder recategorises their mirrored transaction and the
  payer later edits the split
- **THEN** the mirrored transaction's amount and date follow the split, and
  its category stays as the share holder set it

#### Scenario: The ledger refuses to rewrite a split's facts

- **WHEN** a share holder tries to change a mirrored transaction's amount,
  date, currency or type to a different value, or to delete it, through the
  finance API
- **THEN** the request is rejected and the transaction is unchanged, and the
  monthly summary's expense total does not move

#### Scenario: Recategorising a mirror through a full-replace update works

- **WHEN** a share holder PUTs a mirrored transaction with a new category and
  the same amount, date and currency it already has
- **THEN** the update succeeds — resending unchanged values is how a
  full-replace update expresses "only the category changed"

#### Scenario: A split edit that lands mid-update is not silently reverted

- **WHEN** a share holder's update of their mirrored transaction is checked
  against the amount they read, and the payer's edit to the split commits
  before that update is written
- **THEN** the update is refused as a conflict and none of it is applied — not
  even the category change, which alone would have been allowed — and the
  transaction still carries the split's new amount

#### Scenario: A renamed 其他 does not break someone else's split

- **WHEN** a share holder has renamed their 其他 expense category and a split
  names a category they do not have
- **THEN** their 其他 expense category is recreated and the mirror lands on
  it — not on whatever expense category happened to be left over

#### Scenario: A share holder who has never opened the ledger still gets one

- **WHEN** a user with no finance categories at all is given a share on a
  split that names a category
- **THEN** their default categories are seeded and the mirrored transaction
  lands on the named category the seeding just created, not on 其他

#### Scenario: An unsupported currency is reported, not mirrored

- **WHEN** a split is recorded in a currency outside the finance whitelist
- **THEN** no transaction is created, and the split-spending report shows
  that currency marked as not counted in the user's transactions

#### Scenario: A mirrored currency is marked as already counted

- **WHEN** the user has TWD split shares in the month
- **THEN** the split-spending report shows TWD marked as already counted in
  the user's transactions, so adding it to the summary total would
  double-count

#### Scenario: A scheduled share reaches the ledger one period at a time

- **WHEN** a share of 6000 is repaid over twelve periods of 500
- **THEN** the holder's ledger has twelve transactions of 500, one per period,
  and no transaction for the 6000

#### Scenario: The schedule replaces the share, never joins it

- **WHEN** a scheduled share is recorded
- **THEN** the holder's total mirrored spending for that expense is the share,
  not the share plus the periods

#### Scenario: An unscheduled share is unchanged

- **WHEN** a share carries no repayment schedule
- **THEN** it is mirrored as one transaction, exactly as before

#### Scenario: Scheduling does not change what is owed

- **WHEN** a share is put on a twelve-period schedule and none of it has been
  repaid yet
- **THEN** the balance still says the whole share is owed, and the debt is
  reported rather than omitted as if nothing were owed

#### Scenario: A scheduled period is not a repayment

- **WHEN** a period's date arrives and the holder has not actually paid
- **THEN** the balance is unchanged — only a recorded repayment moves it

