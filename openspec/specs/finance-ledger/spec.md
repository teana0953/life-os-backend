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

- **WHEN** user B attempts to GET, PUT, or DELETE a transaction created by user A
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

### Requirement: Finance categories are per-user with lazy defaults and soft archive

The system SHALL manage per-user finance categories with `name`, `type`
(`expense` or `income`), `icon`, `sort_order`, and an `archived` flag. The
first time a user lists categories and has none (archived included), the
system SHALL seed the defaults — expense: 餐飲, 交通, 購物, 娛樂, 居住, 醫療,
其他; income: 薪資, 獎金, 利息, 其他 — and this seeding SHALL be idempotent.
Categories SHALL never be hard-deleted through the API: archiving hides a
category from new use while existing transactions keep referencing it. An
archived category SHALL NOT accept new transactions, and updating a
transaction SHALL reject switching it onto an archived category — but a
transaction already referencing an archived category SHALL remain editable
(amount, date, note) as long as its category is unchanged. A category's
`type` SHALL be immutable after creation.

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

### Requirement: Monthly summary aggregates per currency without conversion

The system SHALL provide GET `/api/finance/summary?month=YYYY-MM` returning,
for the authenticated user's transactions in that month: per-currency totals
(`expense`, `income`, and `net` = income − expense), and per-category
per-currency amounts. Amounts in different currencies SHALL be reported as
separate rows and never converted or mixed. Aggregation SHALL happen in the
database query, and a month with no transactions SHALL return empty lists.

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

