## MODIFIED Requirements

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
