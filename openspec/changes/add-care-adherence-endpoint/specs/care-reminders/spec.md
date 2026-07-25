## ADDED Requirements

### Requirement: Care adherence over a date range

The system SHALL expose an authenticated `GET /api/care/adherence?from=&to=` returning, for each
local date in `[from, to]`, the number of scheduled care slots and the counts of logged done,
skipped, and missed outcomes for that date. The scheduled count SHALL reflect each schedule's
recurrence (weekday selection, start/end dates, and the every-N-weeks interval). The response
SHALL cover every date in the range, including dates with zero scheduled slots. The span SHALL be
bounded and out-of-range or malformed inputs rejected.

#### Scenario: Adherence counts are returned per day
- **WHEN** an authenticated user requests `/api/care/adherence` for a valid `from`/`to`
- **THEN** the response contains one entry per date in `[from, to]` with the scheduled count and the done/skipped/missed counts for that date

#### Scenario: Scheduled reflects recurrence
- **WHEN** a schedule is active on some dates and inactive on others (by weekday, start/end, or every-N-weeks)
- **THEN** the scheduled count is non-zero only on the dates the schedule is active

#### Scenario: A date with no schedules is still present
- **WHEN** a date in the range has no active schedules
- **THEN** that date appears with a scheduled count of zero

#### Scenario: Outcome counts come from the logs
- **WHEN** a date has done/skipped/missed care logs
- **THEN** that date's done, skipped, and missed counts reflect those logs

#### Scenario: An over-wide or malformed range is rejected
- **WHEN** `from`/`to` are missing/malformed, or the span exceeds the maximum
- **THEN** the request is rejected with a 400

#### Scenario: The endpoint requires auth and is per-user
- **WHEN** the request has no valid token
- **THEN** it is rejected with a 401, and a valid request returns only the caller's own data
