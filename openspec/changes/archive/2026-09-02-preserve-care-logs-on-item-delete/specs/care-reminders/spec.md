## ADDED Requirements

### Requirement: Adherence records survive their care item

An adherence record SHALL be a standalone fact about something that happened, not a
child of the plan that produced it. Deleting a care item (or removing a schedule from an
item) SHALL NOT delete, alter, or hide any adherence record already written for it, and
SHALL remain a real deletion of the item — the item itself does not linger in any list,
picker, reminder, or count.

Every adherence record SHALL carry, at the moment it is written, a snapshot of the
naming attributes of the item it belongs to — its title, its category, and its dose text
when the item is a medication. The snapshot SHALL be the values in effect when the record
was written, and SHALL remain readable after the item is gone.

Records written before this capability existed carry a snapshot taken from their item at
the time the capability was introduced. Records whose item was already deleted before that
point are gone and SHALL NOT be reconstructed.

#### Scenario: Deleting a care item keeps its records
- **WHEN** a user deletes a care item that has adherence records
- **THEN** the item and its schedules are gone, and every one of its adherence records
  still exists with its date, time, status, completion time, and dose quantity unchanged

#### Scenario: A record keeps the name the item had
- **WHEN** an adherence record is written and the item is later renamed, re-categorized,
  or has its dose text changed
- **THEN** the record still reports the title, category, and dose the item had when the
  record was written

#### Scenario: Removing one schedule keeps that schedule's records
- **WHEN** a user updates a care item so that one of its schedules is removed
- **THEN** the adherence records written for that schedule still exist and remain readable

#### Scenario: A deleted item stops producing new work
- **WHEN** a care item is deleted
- **THEN** no reminder is ever delivered or re-nagged for it again, it appears in no
  today list, and no new adherence record can be written for it

### Requirement: Deleted-item records are identifiable in history

History responses SHALL mark each record whose care item no longer exists, so a client can
show it as a past record rather than as something still being tracked. For such a record
the identifiers of the item and schedule SHALL be reported as absent, and its title,
category, and dose SHALL come from the record's own snapshot.

#### Scenario: A deleted item's record is flagged
- **WHEN** history includes a record whose care item has been deleted
- **THEN** the record is marked as belonging to a deleted item, carries no item or schedule
  identifier, and shows the title, category, and dose from its snapshot

#### Scenario: A live item's record is not flagged
- **WHEN** history includes a record whose care item still exists
- **THEN** the record is not marked as deleted, carries its item identifier, and shows the
  item's current title, category, and dose

#### Scenario: A record whose schedule alone was removed keeps its item
- **WHEN** history includes a record whose care item still exists but whose schedule was
  removed by an item edit dropping that time-of-day
- **THEN** the record is not marked as deleted and carries its item identifier, while its
  schedule identifier is reported as absent

## MODIFIED Requirements

### Requirement: Manage care reminders across categories

An authenticated user SHALL be able to create, list, update, and delete care reminders.
Each has a category (`medication`, `rehab`, `radiotherapy_care`, or `custom`), a title, an
optional free-text instruction note, and one or more schedules (each a time-of-day with
weekdays, an every-N-weeks interval, a start date, an optional end date, a per-occurrence
dose quantity, a nag interval, and an enabled flag). Medication reminders additionally may
carry a dose, stock, and low-stock threshold. Reminders are scoped to the owning user.
Deletion removes the reminder and its schedules outright; it SHALL NOT remove the adherence
records already written against them.

#### Scenario: Create and list a care reminder in any category
- **WHEN** the user creates a reminder with a category, title, and one or more schedules
- **THEN** it is stored and returned with its schedules, and appears in that user's list; listing MAY be filtered by category

#### Scenario: Rehab and radiotherapy reminders use the instruction note
- **WHEN** the user creates a `rehab` or `radiotherapy_care` reminder with an instruction note and no dose/stock
- **THEN** it is stored and scheduled the same as any other reminder, carrying its note

#### Scenario: Invalid input is rejected
- **WHEN** a `time_of_day` is not `HH:mm`, a `repeat_days` value is outside 0–6, `week_interval` < 1, a date is not real or end is before start, the category is unknown, or a given stock/stock_alert is negative
- **THEN** the API returns 400

#### Scenario: Update and delete are owner-scoped
- **WHEN** the user updates or deletes their own reminder
- **THEN** the change applies (schedules updated inline), and a reminder not owned by the caller is unaffected

#### Scenario: Deleting a reminder does not delete its history
- **WHEN** the user deletes a reminder that has adherence records
- **THEN** the reminder and its schedules are removed and its adherence records are kept

#### Scenario: Reminder endpoints require authentication
- **WHEN** a care request arrives without a valid lifeos token
- **THEN** the API returns 401

### Requirement: Record adherence and decrement medication stock

An authenticated user SHALL be able to record a slot as done or skipped, which stops its
nag. Recording a medication slot as done SHALL decrement that item's stock (when tracked)
by the schedule's dose quantity, never below zero. Past-day slots left unanswered SHALL be
recorded as missed. Every adherence record written by any of these paths SHALL carry the
item's title, category, and dose as they stand at the moment of writing.

#### Scenario: Marking a slot done records adherence and stops the nag
- **WHEN** the user posts a `done` (or `skipped`) for a slot
- **THEN** an adherence log is stored idempotently for that slot and no further nags are sent

#### Scenario: A done medication slot decrements stock, clamped at zero
- **WHEN** a `done` is recorded for a medication reminder that tracks stock
- **THEN** the stock is reduced by the schedule's dose quantity, never going below zero; a non-medication done changes no stock

#### Scenario: An unanswered past slot becomes missed
- **WHEN** a slot from a previous local day was never answered
- **THEN** it is recorded as missed

#### Scenario: Every write path snapshots the item
- **WHEN** a record is created by answering a slot, by editing a past slot, or by the
  missed sweep
- **THEN** the stored record carries the item's title, category, and dose from that moment

### Requirement: Per-slot care records over a date range

The system SHALL expose an authenticated `GET /api/care/range?from=&to=` returning, for each local
date in `[from, to]`, that date's care records. A date's records SHALL be the union of two sources,
with no record appearing twice:

1. the slots produced by the caller's enabled schedules that are active on that date, and
2. every adherence record the caller has on that date, including records whose schedule is
   disabled, is inactive on that date, has been removed, or whose care item has been deleted.

A slot's status SHALL be its logged status when a log exists; otherwise, for a past date it SHALL
be `missed`, for today `overdue`/`pending` by the slot's time, and for a future date `pending`.
A record surfaced by source 2 alone SHALL carry its own stored status, time of day, dose quantity,
and completion time. The span SHALL be bounded and malformed/out-of-range inputs rejected. Data
SHALL be per-user.

#### Scenario: Slots are returned per day
- **WHEN** an authenticated user requests `/api/care/range` for a valid from/to
- **THEN** each date in `[from, to]` lists its active-that-date slots, each with status/time/title/dose

#### Scenario: Status comes from the log, else derived
- **WHEN** a slot has a care log
- **THEN** its status is the logged status (done/skipped/missed); otherwise a past date's slot is missed and today's is overdue or pending by time

#### Scenario: Every record in the range is returned exactly once
- **WHEN** the range contains adherence records
- **THEN** each of them appears exactly once, on its own local date — whether or not a live
  schedule also produces a slot for it

#### Scenario: A deleted item's records still appear
- **WHEN** the range covers dates on which a since-deleted care item was recorded as done,
  skipped, or missed
- **THEN** those records are returned on their dates, named from their snapshot and marked as
  belonging to a deleted item

#### Scenario: A disabled or inactive schedule's records still appear
- **WHEN** a schedule is disabled, or is inactive on a date it has a record for (weekday /
  start-end / every-N-weeks)
- **THEN** that record is still returned on that date, from the record itself

#### Scenario: Only enabled, active schedules appear
- **WHEN** a schedule is disabled, or inactive on a date (weekday/start-end/every-N-weeks), and has
  no adherence record on that date
- **THEN** it contributes no slot on that date

#### Scenario: Range is bounded and validated
- **WHEN** from/to are missing/malformed, from > to, or the span exceeds the maximum
- **THEN** the request is rejected with 400; without a token it is 401

### Requirement: Today's care slots with status

An authenticated user SHALL be able to fetch today's due care slots (in their timezone),
each tagged with its status, for a daily checklist. The response SHALL carry the local date
and, for each enabled schedule active today, one slot with its item's title/category/note
(and dose for medication) and its status. The endpoint SHALL NOT write any data. Records
belonging to deleted care items SHALL NOT appear here: today's list is a list of things to
do, and a deleted item is not one of them.

#### Scenario: Today's active slots are returned with status
- **WHEN** an authenticated user requests today's care slots
- **THEN** the response includes today's local date and, for each enabled schedule active today, a slot with its title, time, and status

#### Scenario: A slot's status reflects its log or the time of day
- **WHEN** a slot has a done/skipped/missed adherence log
- **THEN** the slot carries that status (with the done time when done)
- **WHEN** a slot has no log and its time has passed in the user's timezone
- **THEN** the slot's status is overdue
- **WHEN** a slot has no log and its time is still upcoming
- **THEN** the slot's status is pending

#### Scenario: Inactive schedules are excluded
- **WHEN** a schedule is disabled, or not active today (weekday not selected, off the every-N-weeks interval, or outside its date range)
- **THEN** it produces no slot for today

#### Scenario: A deleted item's record for today is excluded
- **WHEN** a care item is deleted after one of today's slots was already recorded
- **THEN** today's list no longer shows that slot, even though the record is kept and still
  appears in the date-range history

#### Scenario: Timezone drives the day and the overdue boundary
- **WHEN** the user's timezone determines a local date and current local time
- **THEN** the returned date and each slot's overdue/pending status are computed in that timezone

#### Scenario: The today endpoint requires authentication
- **WHEN** the request has no valid lifeos token
- **THEN** the API returns 401
