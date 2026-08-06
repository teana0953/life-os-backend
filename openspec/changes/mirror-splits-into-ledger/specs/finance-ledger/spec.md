## MODIFIED Requirements

### Requirement: Split spending is reported per month without becoming transactions

A split expense SHALL create one finance transaction per share holder, for
that holder's own share, in the same atomic write as the split expense
itself — so the money is visible everywhere personal spending is: the ledger,
the monthly summary, budgets, budget alerts, trends and net worth. This
requirement's former outcome, that no transaction is created, no longer
holds; its name is kept so the inversion is explicit rather than silent.

A mirrored transaction SHALL carry the split expense it came from. Its
`amount`, `date` and `currency` SHALL NOT be editable through the finance
API, and it SHALL NOT be deletable there: those are facts of the split, and
changing them in one place only would make the two views disagree. Its
`category_id` and `note` SHALL be editable, and once edited SHALL NOT be
overwritten by later edits to the split.

The mirrored transaction's category SHALL be the share holder's own category
of the same name as the one chosen on the split, falling back to their 其他
category, seeding their default categories first if they have none. A
mirrored transaction MAY land on an archived category, unlike a
user-created one, because the mirror is not a choice and refusing it would
drop a real expense.

The payer SHALL be mirrored only for their own share; fronting money for
others is not spending. A repayment SHALL NOT be mirrored.

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

#### Scenario: No transaction is created

This scenario is kept under its former name so the inversion is loud.

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

#### Scenario: Editing the split moves both mirrors

- **WHEN** the payer changes the dinner's amount, date or participants
- **THEN** every affected share holder's mirrored transaction changes with
  it, and a share holder who was removed no longer has one

#### Scenario: A hand-picked category survives the next split edit

- **WHEN** a share holder recategorises their mirrored transaction and the
  payer later edits the split
- **THEN** the mirrored transaction's amount and date follow the split, and
  its category stays as the share holder set it

#### Scenario: The ledger refuses to rewrite a split's facts

- **WHEN** a share holder tries to change a mirrored transaction's amount,
  date or currency, or to delete it, through the finance API
- **THEN** the request is rejected and the transaction is unchanged

#### Scenario: A share holder who has never opened the ledger still gets one

- **WHEN** a user with no finance categories at all is given a share
- **THEN** their default categories are seeded and the mirrored transaction
  is created

#### Scenario: A mirror may land on an archived category

- **WHEN** a share holder has archived the category the split names
- **THEN** their mirrored transaction still uses it, while creating a
  transaction on that category through the API is still rejected

#### Scenario: An unsupported currency is reported, not mirrored

- **WHEN** a split is recorded in a currency outside the finance whitelist
- **THEN** no transaction is created, and the split-spending report shows
  that currency marked as not counted in the user's transactions

#### Scenario: A mirrored currency is marked as already counted

- **WHEN** the user has TWD split shares in the month
- **THEN** the split-spending report shows TWD marked as already counted in
  the user's transactions, so adding it to the summary total would
  double-count
