## MODIFIED Requirements

### Requirement: Budget progress reports TWD spending for a month

GET `/api/finance/budgets?month=YYYY-MM` SHALL return every budget with that
month's progress: `spent`, `remaining` (amount − spent, may be negative), and
`percent`.

`spent` SHALL be the sum of the user's TWD expense transactions in that month —
all of them for the overall budget, the category's for a category budget.
Non-TWD transactions SHALL NOT count toward any budget. Aggregation SHALL
happen in the database.

The user's own share of a shared expense SHALL count, because it is one of
those transactions: it is mirrored into the ledger when the split is
recorded, carrying the category the split named. Money repaid between people
SHALL NOT count, because a repayment is never mirrored.

#### Scenario: Progress splits overall and category scopes

- **WHEN** a user with an overall budget 10000 and a 餐飲 budget 3000 has July
  TWD expenses of 餐飲 2500 and 交通 1000, plus a USD expense
- **THEN** July progress shows the overall budget spent 3500 and the 餐飲
  budget spent 2500, the USD expense counted in neither

#### Scenario: A split expense does not consume a budget

This scenario is kept under its former name so the inversion is explicit: a
share now DOES consume a budget, because it is a transaction.

- **WHEN** the user holds a TWD share on a shared expense in the month
- **THEN** the overall budget's `spent` includes it, and so does the budget
  for the category the split named

### Requirement: Crossing a budget threshold pushes once per month


After a TWD expense transaction is created or updated, the system SHALL
check each affected budget (the overall budget and the transaction's
category budget; on update, both the old and new category when the category
changed) for the month of the transaction's date. When the month's spent
reaches 80% or 100% of a budget and no alert for that (budget, month,
threshold) has been recorded, the system SHALL record the alert and send a
Web Push notification through the user's existing push subscriptions. The
same (budget, month, threshold) SHALL never notify twice, including under
concurrent writes (database-level uniqueness). Push failure SHALL NOT fail
the transaction write. Deleting a transaction SHALL neither trigger checks
nor retract alerts.

Recording or editing a shared expense SHALL run this same check for every
share holder whose mirrored transaction was written, on the same best-effort
terms: a failing check or push SHALL NOT fail the split write. A share holder
SHALL be notified about their own budget even though someone else's action
crossed it. Editing a shared expense SHALL check the categories the mirrors
now carry; it SHALL NOT be required to check a category a mirror carried
before the edit, because spending on the category it left can only fall, and
this check only ever fires on the way up.

#### Scenario: Crossing 80 percent notifies once

- **WHEN** a user with a 餐飲 budget of 1000 records TWD 餐飲 expenses of 700
  then 150 in the same month, then another 50
- **THEN** exactly one 80% alert push is sent (at the 850 write), and the 50
  write sends nothing

#### Scenario: One write can cross both thresholds

- **WHEN** the month's spent jumps from 0 to 1200 against a 1000 budget in a
  single transaction
- **THEN** the 80% and 100% alerts are both recorded and both pushed

#### Scenario: Backdated transactions check their own month

- **WHEN** in August the user records a TWD expense dated in July that pushes
  July's spent over a threshold
- **THEN** the alert is recorded and pushed for July, keyed to July's month

#### Scenario: Non-TWD and income writes never alert

- **WHEN** the user records a USD expense or a TWD income of any size
- **THEN** no budget check fires and no push is sent

#### Scenario: Push failure does not break the write

- **WHEN** every push subscription send fails while recording a
  threshold-crossing expense
- **THEN** the transaction is stored and the API responds success

#### Scenario: A share crosses a threshold for someone who did not write it

- **WHEN** another participant records a shared expense whose share pushes the
  user past 80% of their overall budget
- **THEN** the user is notified once, exactly as if they had recorded the
  expense themselves

#### Scenario: A failing alert does not fail the split

- **WHEN** the budget-alert check throws while a shared expense is recorded
- **THEN** the expense, its shares and its mirrors are all stored and the API
  responds success
