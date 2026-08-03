# finance-budgets Specification

## Purpose
TBD - created by archiving change add-finance-budgets. Update Purpose after archive.
## Requirements
### Requirement: Monthly recurring budgets in TWD

The system SHALL let an authenticated user maintain recurring monthly budgets
in TWD: at most one overall budget (no category) and at most one budget per
expense category, each a positive integer amount. Setting a budget that
already exists SHALL update its amount (upsert). A category budget SHALL be
rejected when the category does not exist for that user (404), is an income
category, or is archived (400). Deleting a budget SHALL remove it and its
alert records. Budgets SHALL be scoped to the authenticated user.

#### Scenario: Upsert overall and category budgets

- **WHEN** a user PUTs an overall budget of 20000 and later PUTs 25000
- **THEN** one overall budget exists with amount 25000

#### Scenario: Category budget validation

- **WHEN** a user PUTs a budget for an income category, an archived category,
  or another user's category
- **THEN** the request fails (400 for income/archived, 404 for another
  user's) and no budget is stored

### Requirement: Budget progress reports TWD spending for a month

GET `/api/finance/budgets?month=YYYY-MM` SHALL return every budget with that
month's progress: `spent` (the sum of the user's TWD expense transactions in
that month — all of them for the overall budget, the category's for a
category budget), `remaining` (amount − spent, may be negative), and
`percent`. Non-TWD transactions SHALL NOT count toward any budget.
Aggregation SHALL happen in the database. Split shares and settlements SHALL
NOT count toward any budget: a split carries no finance category, so it
cannot be attributed to a category budget, and budget alerts fire when a
transaction is written — which a split never is.

#### Scenario: Progress splits overall and category scopes

- **WHEN** a user with an overall budget 10000 and a 餐飲 budget 3000 has July
  TWD expenses of 餐飲 2500 and 交通 1000, plus a USD expense
- **THEN** July progress shows the overall budget spent 3500 and the 餐飲
  budget spent 2500, the USD expense counted in neither

#### Scenario: A split expense does not consume a budget

- **WHEN** the user holds a TWD share on a split expense in the month
- **THEN** every budget's `spent` is unchanged and no alert is raised

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

