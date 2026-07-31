## ADDED Requirements

### Requirement: Net-worth accounts with fixed kind and custom names

The system SHALL let an authenticated user maintain net-worth accounts, each
with a fixed `kind` (`asset` or `liability`, immutable after creation), a
custom `name`, a `sort_order`, and an `archived` flag. The first time a user
lists accounts with none (archived included), the system SHALL seed defaults
— assets: 台幣活存, 台幣定存, 外幣, 股票, 基金, 儲蓄險; liabilities: 房貸或房租,
信用卡, 學貸, 其他負債 — idempotently. Account names SHALL be unique within a
user's same kind. An archived account SHALL NOT accept new snapshots but its
existing snapshots SHALL remain readable. Accounts SHALL be scoped to the
user (another user's account is a 404).

#### Scenario: First list seeds defaults idempotently

- **WHEN** a user with no accounts calls GET accounts twice
- **THEN** both responses contain the same default set, seeded once

#### Scenario: Duplicate name within a kind is rejected

- **WHEN** a user creates a second asset account named 股票
- **THEN** the request fails with 400 and no account is created

#### Scenario: Kind is immutable and users are isolated

- **WHEN** a user tries to change an account's kind, or acts on another
  user's account
- **THEN** the kind change is not applied, and another user's account is 404

### Requirement: Monthly market-value snapshots overwrite

The system SHALL store at most one snapshot value per account per month
(`YYYY-MM`), a non-negative TWD integer where both assets and liabilities
are recorded as positive amounts. Writing a snapshot for an existing
(account, month) SHALL overwrite it. Writing a snapshot onto an archived
account SHALL fail.

#### Scenario: Re-writing a month overwrites

- **WHEN** a user PUTs 30000 then 25000 for the same account and month
- **THEN** that account-month holds a single snapshot of 25000

#### Scenario: Snapshot validation

- **WHEN** a user PUTs a negative value, a malformed month, or targets an
  archived or non-existent/foreign account
- **THEN** the request fails (400 for value/month/archived, 404 for
  foreign/missing) and nothing is stored

### Requirement: Monthly net worth and growth rate

GET `/api/finance/networth?month=YYYY-MM` SHALL return that month's account
values plus `total_asset` (sum of asset snapshots), `total_liability` (sum
of liability snapshots), `net_worth` (total_asset − total_liability),
`prev_net_worth` (the prior month's net worth), and `growth_rate`
((net_worth − prev_net_worth) / prev_net_worth). Aggregation SHALL happen in
the database. "Prior month" means the most recent earlier month that has any snapshot
(not necessarily the calendar previous month). When there is no such month,
or the prior net worth is zero or negative, `growth_rate` SHALL be null (a
ratio against a zero or negative base is undefined or sign-misleading);
`prev_net_worth` SHALL still be returned when a prior month exists.

#### Scenario: Net worth subtracts liabilities and computes growth

- **WHEN** July has asset snapshots summing 520000 and liability snapshots
  summing 41484, and June's net worth was 460181
- **THEN** July returns total_asset 520000, total_liability 41484, net_worth
  478516, prev_net_worth 460181, and a growth_rate of about 0.0398

#### Scenario: First month has null growth

- **WHEN** the queried month has snapshots but no prior month has any
- **THEN** net_worth is returned while prev_net_worth and growth_rate are null

### Requirement: Net-worth trend series

GET `/api/finance/networth/trend?from=YYYY-MM&to=YYYY-MM` SHALL return the
per-month net worth (asset sum − liability sum) for months in range that
have snapshots, in ascending month order. A range with no snapshots SHALL
return an empty series.

#### Scenario: Trend lists months ascending

- **WHEN** the user has snapshots in 2026-01 and 2026-03 within the range
- **THEN** the series lists 2026-01 then 2026-03 with each month's net worth,
  and a month with no snapshots is absent
