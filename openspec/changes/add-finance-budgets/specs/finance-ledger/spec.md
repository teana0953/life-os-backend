## MODIFIED Requirements

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
