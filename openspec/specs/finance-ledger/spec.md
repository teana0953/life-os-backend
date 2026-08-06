# finance-ledger Specification

## Purpose
TBD - created by archiving change add-finance-ledger. Update Purpose after archive.
## Requirements
### Requirement: Finance transactions are per-user CRUD records

The system SHALL let an authenticated user create, list, update, and delete
finance transactions. A transaction records `type` (`expense` or `income`), a
positive integer `amount` in the currency's minor-or-natural unit (TWD in 元,
USD in cents), a `currency` from the supported whitelist (defaulting to `TWD` on create;
required on full-replace update, so an omitted currency can never silently
rewrite a foreign-currency transaction), a `category_id` referencing one of
the user's finance categories, a `date` as a `YYYY-MM-DD` string, and an
optional `note`. Listing SHALL require a `from`/`to` date range and return
the user's transactions in that range.
Every operation SHALL be scoped to the authenticated user: another user's
transaction SHALL be indistinguishable from a missing one (404).

A transaction mirrored from a split expense SHALL be identified as such in
every response that returns it, and SHALL NOT be deletable or have its
`amount`, `date`, `currency` or `type` changed through this API.

A successful create or update of a TWD expense transaction SHALL additionally
trigger the budget-alert check defined by the `finance-budgets` capability;
this side effect is best-effort and SHALL NOT change the operation's response
or failure behavior.

#### Scenario: Create and list a transaction

- **WHEN** a user POSTs a valid expense transaction for `2026-07-15`
- **THEN** the response contains the stored transaction with its id
- **AND** GET `/api/finance/transactions?from=2026-07-01&to=2026-07-31` includes it

#### Scenario: Validation rejects bad input

- **WHEN** a user POSTs a transaction with `amount` of `0` or negative, a
  currency outside the whitelist, a malformed `date`, or a missing
  `category_id`
- **THEN** the request fails with 400 and nothing is stored

#### Scenario: Users are isolated

Isolation is by owner, not by writer: a mirrored transaction is created by
someone else's action but belongs to the share holder, who may read and
recategorise it.

- **WHEN** user B attempts to GET, PUT, or DELETE a transaction **owned** by
  user A
- **THEN** the response is 404 and A's data is unchanged

#### Scenario: Category must match transaction type

- **WHEN** a user POSTs an `expense` transaction whose `category_id` is an
  `income` category, or a category belonging to another user
- **THEN** the request fails (400 for type mismatch, 404 for another user's
  category) and nothing is stored

#### Scenario: Write succeeds even when the alert side effect fails

- **WHEN** a user POSTs a valid TWD expense and the budget-alert check or its
  push delivery throws
- **THEN** the transaction is stored and the response is the normal success

#### Scenario: A mirrored transaction is marked in the listing

- **WHEN** a share holder lists transactions for a month containing a split
- **THEN** the mirrored transaction is present and identifiable as coming
  from a split, so a client can present it as partly locked

### Requirement: Finance categories are per-user with lazy defaults and soft archive

The system SHALL manage per-user finance categories with `name`, `type`
(`expense` or `income`), `icon`, `sort_order`, and an `archived` flag. The
defaults — expense: 餐飲, 交通, 購物, 娛樂, 居住, 醫療, 其他; income: 薪資,
獎金, 利息, 其他 — SHALL be seeded the first time a user has none (archived
included), whether that is because they listed their categories or because a
split expense needs to be mirrored into their ledger. This seeding SHALL be
idempotent.

Categories SHALL never be hard-deleted through the API: archiving hides a
category from new use while existing transactions keep referencing it. An
archived category SHALL NOT accept new transactions **created through this
API**, and updating a transaction SHALL reject switching it onto an archived
category — but a transaction already referencing an archived category SHALL
remain editable (amount, date, note) as long as its category is unchanged. A
transaction mirrored from a split expense MAY land on an archived category,
because it is not a choice the user is making and refusing it would drop a
real expense. A category's `type` SHALL be immutable after creation.

#### Scenario: First list seeds defaults idempotently

- **WHEN** a user with no categories calls GET `/api/finance/categories` twice
- **THEN** both responses contain exactly the default set, seeded once

#### Scenario: Archived category blocks new transactions but keeps history readable and editable

- **WHEN** a user archives a category that has transactions, then POSTs a new
  transaction with that category
- **THEN** the POST fails with 400
- **AND** listing transactions still returns the existing ones referencing it
- **AND** updating an existing transaction's amount or note while keeping that
  archived category succeeds, but switching a transaction onto the archived
  category fails with 400

#### Scenario: Defaults are seeded for a share holder who never opened the ledger

- **WHEN** a user with no categories at all is given a share on a split
  expense
- **THEN** their defaults are seeded and their mirrored transaction is
  created, on the category the split named

#### Scenario: A mirror may land on an archived category

- **WHEN** a share holder has archived the category a split names
- **THEN** their mirrored transaction still uses it, while creating a
  transaction on that category through the API is still rejected

### Requirement: Monthly summary aggregates per currency without conversion

The system SHALL provide GET `/api/finance/summary?month=YYYY-MM` returning,
for the authenticated user's transactions in that month: per-currency totals
(`expense`, `income`, and `net` = income − expense), and per-category
per-currency amounts. Amounts in different currencies SHALL be reported as
separate rows and never converted or mixed. Aggregation SHALL happen in the
database query, and a month with no transactions SHALL return empty lists.

The user's own shares on split expenses SHALL be included, because they are
transactions now. They SHALL NOT be added a second time from the split tables.

#### Scenario: Summary splits currencies and balances totals

- **WHEN** a user has July expenses of TWD 300 and USD 1000 (cents) and July
  income of TWD 50000, and calls GET `/api/finance/summary?month=2026-07`
- **THEN** the totals contain a TWD row (expense 300, income 50000, net 49700)
  and a USD row (expense 1000, income 0, net -1000), each currency separate
- **AND** `by_category` attributes the amounts to their categories per currency

#### Scenario: Summary excludes other users and other months

- **WHEN** user B calls the summary for a month where only user A has data,
  or user A calls it for an empty month
- **THEN** the response contains empty `totals` and `by_category`

#### Scenario: Summary counts a split share exactly once

- **WHEN** the user holds a TWD share on a split expense in the month
- **THEN** the summary's expense total includes it exactly once, and equals
  the overall budget's `spent` for that month

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
others is not spending. A repayment SHALL NOT be mirrored. A zero share SHALL
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

