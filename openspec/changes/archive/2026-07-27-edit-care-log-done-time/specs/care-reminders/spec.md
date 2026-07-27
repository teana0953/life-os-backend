## MODIFIED Requirements

### Requirement: Edit a past care record (overwrite) with stock adjustment

The system SHALL expose an authenticated `PUT /api/care/log` that overwrites a slot's status
(done or skipped), owner-scoped. The caller MAY supply the completion timestamp. When it is
omitted, a completion time already on record SHALL be kept rather than refreshed, and the
current time SHALL be recorded only when there is none to keep. For a
medication item with tracked stock, the stock SHALL be adjusted by the change: decremented by
the dose when the status changes to done from a non-done state, incremented by the dose when it
changes from done to a non-done state, and left unchanged otherwise; stock SHALL never go below
zero.

#### Scenario: Overwriting a slot's status is persisted
- **WHEN** the owner edits a slot's status (done↔skipped)
- **THEN** the log's status is overwritten to the new value

#### Scenario: A supplied completion time is recorded
- **WHEN** the owner edits a slot to done and supplies a completion timestamp
- **THEN** that timestamp is recorded as the log's completion time, rather than the time of the request

#### Scenario: An omitted completion time on a first completion falls back to now
- **WHEN** the owner edits a slot to done without supplying a completion timestamp, and the slot was not already done
- **THEN** the current time is recorded, unchanged from the previous behaviour

#### Scenario: An omitted completion time is stamped when the done record has none
- **WHEN** the owner edits an already-done slot to done without supplying a completion timestamp, and that record has no completion time on it
- **THEN** the current time is recorded — there is nothing to preserve, and a done record without a completion time is exactly what this must not produce

#### Scenario: An omitted completion time never overwrites one already recorded
- **WHEN** the owner edits an already-done slot to done without supplying a completion timestamp
- **THEN** the completion time already on record is kept, rather than being replaced by the time of the request

#### Scenario: A completion time is ignored when the outcome is not done
- **WHEN** the owner edits a slot to skipped, with or without a completion timestamp
- **THEN** the log has no completion time (a skip never completed), and supplying one is not an error

#### Scenario: A malformed completion time is rejected
- **WHEN** the supplied completion time is not a valid timestamp
- **THEN** the request is rejected as a bad request

#### Scenario: The completion time is an absolute instant
- **WHEN** a completion time is supplied
- **THEN** it is interpreted as an absolute instant (the caller carries the timezone offset) and returned normalized to UTC, matching how completion times are already returned

#### Scenario: Editing to done decrements stock once
- **WHEN** a tracked-stock medication slot changes from not-done to done
- **THEN** its stock is decremented by the dose (clamped ≥ 0)

#### Scenario: Editing away from done restores stock
- **WHEN** a tracked-stock medication slot changes from done to not-done
- **THEN** its stock is incremented by the dose

#### Scenario: A no-op status change does not move stock
- **WHEN** an edit keeps the same done/not-done classification
- **THEN** stock is unchanged

#### Scenario: Editing another user's slot is rejected
- **WHEN** the slot's schedule is not owned by the caller
- **THEN** the edit is rejected (not found), and an unauthenticated request is 401
