## ADDED Requirements

### Requirement: Split spending is reported per month without becoming transactions

The system SHALL report, per month and per currency, what the authenticated
user personally owed on split expenses — the sum of their own shares — so
their real spending is visible alongside their recorded transactions. This
SHALL be a read-time aggregation: **no** finance transaction is created for a
split expense, so editing or deleting the split changes the figure with
nothing to reconcile. Repayments SHALL NOT count as spending, since settling
a debt is not a new expense. The payer's own share SHALL count, because they
genuinely spent it — unlike the balance calculation, which excludes it
because it answers a different question.

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
- **THEN** the split-spending figure is unchanged

#### Scenario: No transaction is created

- **WHEN** a split expense is recorded
- **THEN** the user's finance transactions are unchanged, and deleting the
  split expense removes it from the split-spending figure with no leftover
  record

#### Scenario: A month with no splits reports nothing

- **WHEN** the user has no split shares in the month
- **THEN** the report is empty rather than a zero row per currency

## MODIFIED Requirements

### Requirement: Monthly summary aggregates per currency without conversion

The system SHALL provide GET `/api/finance/summary?month=YYYY-MM` returning,
for the authenticated user's transactions in that month: per-currency totals
(`expense`, `income`, and `net` = income − expense), and per-category
per-currency amounts. Amounts in different currencies SHALL be reported as
separate rows and never converted or mixed. Aggregation SHALL happen in the
database query, and a month with no transactions SHALL return empty lists.
Split spending SHALL NOT be folded into these totals: it is reported
separately so the two can be told apart and reconciled, and so this response
stays compatible with the clients already reading it.

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

#### Scenario: Summary is unaffected by split expenses

- **WHEN** the user holds shares on split expenses in the month
- **THEN** the summary's totals and categories are exactly what the user's
  own transactions produce, unchanged
