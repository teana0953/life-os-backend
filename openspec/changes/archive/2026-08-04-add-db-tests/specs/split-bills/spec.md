## ADDED Requirements

### Requirement: The split queries are proven against a real database

The queries that decide who can see a split record and how much anyone owes
SHALL be verified by executing them against a real PostgreSQL engine with the
project's own migrations applied — not against a test double. Each such test SHALL be shown to fail
when the part of the query it covers is made wrong, so that passing means the
query is right rather than that nothing was checked. A behaviour that holds
**by construction** rather than by a query — one table simply not being read
by another query — SHALL NOT be written as a test here, since no mutation
could make it fail; state it where the code is instead.

#### Scenario: Visibility is proven, not assumed

- **WHEN** the expense listing query runs for someone who is neither a payer,
  a share holder, nor a member of the expense's group
- **THEN** the expense is absent from the result, executed against a real
  database

#### Scenario: A repayment moves the balance in the proven direction

- **WHEN** someone owes 450 and repays 300, and the balance query is executed
  against a real database
- **THEN** the remaining balance is 150 — and reversing the settlement's sign
  in the query makes this fail

#### Scenario: The payer's own share is treated oppositely in the two queries

- **WHEN** a payer holds a share in their own expense
- **THEN** the balance query excludes it while the split-spending query
  includes it, both executed against a real database

#### Scenario: Currencies are never combined

- **WHEN** a pair has balances in two currencies and settles one
- **THEN** only that currency changes, executed against a real database
