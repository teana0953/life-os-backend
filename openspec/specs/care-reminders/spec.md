# care-reminders Specification

## Purpose
TBD - created by archiving change add-care-reminders. Update Purpose after archive.
## Requirements
### Requirement: Manage care reminders across categories

An authenticated user SHALL be able to create, list, update, and delete care reminders.
Each has a category (`medication`, `rehab`, `radiotherapy_care`, or `custom`), a title, an
optional free-text instruction note, and one or more schedules (each a time-of-day with
weekdays, an every-N-weeks interval, a start date, an optional end date, a per-occurrence
dose quantity, a nag interval, and an enabled flag). Medication reminders additionally may
carry a dose, stock, and low-stock threshold. Reminders are scoped to the owning user.

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

#### Scenario: Reminder endpoints require authentication
- **WHEN** a care request arrives without a valid lifeos token
- **THEN** the API returns 401

### Requirement: Every day when no weekday is chosen

A schedule with an empty `repeat_days` SHALL be treated as recurring every day.

#### Scenario: Empty weekday set fires daily
- **WHEN** a schedule has no `repeat_days` selected
- **THEN** it is active on every weekday (subject to the week-interval and date range)

### Requirement: Deliver and re-nag due reminders until answered

A per-minute scheduler SHALL, for each enabled schedule active for the current local day
and time (in the user's timezone), deliver the reminder as a Web Push to the user's
subscribed devices, and SHALL re-deliver ("nag") an unanswered slot every
`nag_interval_minutes` until it is answered or the local day ends. A `nag_interval_minutes`
of 0 SHALL deliver exactly once. Delivery SHALL be exactly one push per nag window per slot.

#### Scenario: A due reminder is delivered
- **WHEN** the current local time matches a schedule's time on an active day
- **THEN** a Web Push carrying the reminder's title is sent to each of the user's subscriptions

#### Scenario: An unanswered reminder nags at its interval
- **WHEN** a delivered slot is still unanswered and `nag_interval_minutes` has elapsed since the last delivery, within the same local day
- **THEN** the reminder is delivered again

#### Scenario: Answering stops the nag
- **WHEN** a `done` or `skipped` log exists for the slot
- **THEN** no further deliveries are sent for that slot

#### Scenario: A single-fire reminder is not repeated
- **WHEN** a schedule's `nag_interval_minutes` is 0
- **THEN** the slot is delivered once and never re-nagged

#### Scenario: Inactive day/interval/range does not fire
- **WHEN** today's weekday is not selected (and repeat_days is non-empty), or the every-N-weeks interval is off, or the date is outside the schedule's start/end range, or the schedule is disabled
- **THEN** no reminder is produced

#### Scenario: A gone subscription is pruned
- **WHEN** delivering, the push service reports a subscription gone (404/410)
- **THEN** that subscription is deleted

### Requirement: Record adherence and decrement medication stock

An authenticated user SHALL be able to record a slot as done or skipped, which stops its
nag. Recording a medication slot as done SHALL decrement that item's stock (when tracked)
by the schedule's dose quantity, never below zero. Past-day slots left unanswered SHALL be
recorded as missed.

#### Scenario: Marking a slot done records adherence and stops the nag
- **WHEN** the user posts a `done` (or `skipped`) for a slot
- **THEN** an adherence log is stored idempotently for that slot and no further nags are sent

#### Scenario: A done medication slot decrements stock, clamped at zero
- **WHEN** a `done` is recorded for a medication reminder that tracks stock
- **THEN** the stock is reduced by the schedule's dose quantity, never going below zero; a non-medication done changes no stock

#### Scenario: An unanswered past slot becomes missed
- **WHEN** a slot from a previous local day was never answered
- **THEN** it is recorded as missed

### Requirement: Per-user timezone

An authenticated user SHALL have a timezone (default `Asia/Taipei`) and be able to set it;
all care-reminder time-of-day evaluation SHALL use that timezone.

#### Scenario: Set a valid timezone
- **WHEN** the user sets a valid IANA timezone
- **THEN** it is saved and used for reminder evaluation

#### Scenario: An invalid timezone is rejected
- **WHEN** the user sets a timezone that is not a valid IANA zone
- **THEN** the API returns 400

### Requirement: Today's care slots with status

An authenticated user SHALL be able to fetch today's due care slots (in their timezone),
each tagged with its status, for a daily checklist. The response SHALL carry the local date
and, for each enabled schedule active today, one slot with its item's title/category/note
(and dose for medication) and its status. The endpoint SHALL NOT write any data.

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

#### Scenario: Timezone drives the day and the overdue boundary
- **WHEN** the user's timezone determines a local date and current local time
- **THEN** the returned date and each slot's overdue/pending status are computed in that timezone

#### Scenario: The today endpoint requires authentication
- **WHEN** the request has no valid lifeos token
- **THEN** the API returns 401

