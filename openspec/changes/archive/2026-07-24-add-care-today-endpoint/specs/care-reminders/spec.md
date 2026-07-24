## ADDED Requirements

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
