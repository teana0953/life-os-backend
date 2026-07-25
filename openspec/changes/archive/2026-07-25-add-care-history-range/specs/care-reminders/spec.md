## ADDED Requirements

### Requirement: Per-slot care records over a date range

The system SHALL expose an authenticated `GET /api/care/range?from=&to=` returning, for each local
date in `[from, to]`, the individual care slots active that date (each enabled schedule active on
that date) with a per-slot status. A slot's status SHALL be its logged status when a log exists;
otherwise, for a past date it SHALL be `missed`, for today `overdue`/`pending` by the slot's time,
and for a future date `pending`. The span SHALL be bounded and malformed/out-of-range inputs
rejected. Data SHALL be per-user.

#### Scenario: Slots are returned per day
- **WHEN** an authenticated user requests `/api/care/range` for a valid from/to
- **THEN** each date in `[from, to]` lists its active-that-date slots, each with status/time/title/dose

#### Scenario: Status comes from the log, else derived
- **WHEN** a slot has a care log
- **THEN** its status is the logged status (done/skipped/missed); otherwise a past date's slot is missed and today's is overdue or pending by time

#### Scenario: Only enabled, active schedules appear
- **WHEN** a schedule is disabled, or inactive on a date (weekday/start-end/every-N-weeks)
- **THEN** it contributes no slot on that date

#### Scenario: Range is bounded and validated
- **WHEN** from/to are missing/malformed, from > to, or the span exceeds the maximum
- **THEN** the request is rejected with 400; without a token it is 401

### Requirement: Edit a past care record (overwrite) with stock adjustment

The system SHALL expose an authenticated `PUT /api/care/log` that overwrites a slot's status
(done or skipped), owner-scoped. For a medication item with tracked stock, the stock SHALL be
adjusted by the change: decremented by the dose when the status changes to done from a non-done
state, incremented by the dose when it changes from done to a non-done state, and left unchanged
otherwise; stock SHALL never go below zero.

#### Scenario: Overwriting a slot's status is persisted
- **WHEN** the owner edits a slot's status (done↔skipped)
- **THEN** the log's status is overwritten to the new value

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
