## MODIFIED Requirements

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

A user SHALL be able to reorder all of their accounts of one `kind` in a
single request, `PUT /api/finance/networth/accounts/order` with body
`{ kind, ids[] }`, which SHALL atomically set each account's `sort_order` to
its index in `ids` (0-based). `ids` SHALL be exactly the set of the user's
account ids of that `kind` — including archived accounts, which share the
same ordering space — never a subset, a superset, nor containing another
user's or another kind's id. Any mismatch SHALL reject the whole request
with 400 and SHALL write nothing. The write SHALL be all-or-nothing: if any
part of the batch fails, no account's `sort_order` SHALL change.

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

#### Scenario: Reordering writes every account's new position atomically

- **WHEN** a user PUTs `ids` in a new order that is exactly their full set of
  asset (or liability) account ids
- **THEN** each account's `sort_order` becomes its index in `ids`, and if any
  one of those writes fails none of them take effect

#### Scenario: An incomplete or foreign id set is rejected without writing

- **WHEN** `ids` omits one of the user's accounts of that `kind`, includes an
  id that is not one of the user's accounts, or includes another user's or
  another kind's account id
- **THEN** the request fails with 400 and no account's `sort_order` changes

#### Scenario: Archived accounts share the ordering space

- **WHEN** a user reorders a kind that includes an archived account
- **THEN** the archived account must be present in `ids` and receives its own
  `sort_order` like any other account
