## ADDED Requirements

### Requirement: Manage medication reminder schedules

An authenticated lifeos user SHALL be able to create, list, update, and delete
medication reminder schedules, each with a label, one or more daily times, a set of
weekdays, an every-N-weeks interval with an anchor date, and an enabled flag.
Schedules SHALL be scoped to the owning user.

#### Scenario: Create and list a medication reminder
- **WHEN** the user POSTs a medication reminder with a label, `times`, `days_of_week`, `week_interval`, and `anchor_date`
- **THEN** it is stored and returned, and appears in that user's list of medication reminders

#### Scenario: Invalid schedule input is rejected
- **WHEN** a `times` entry is not `HH:mm`, a `days_of_week` value is outside 0–6, `week_interval` is below 1, or `anchor_date` is not a real date
- **THEN** the API returns 400

#### Scenario: Update and delete are owner-scoped
- **WHEN** the user updates (including toggling `enabled`) or deletes one of their own reminders
- **THEN** the change applies; and a reminder id not owned by the caller is not affected

#### Scenario: Reminder endpoints require authentication
- **WHEN** a reminder request arrives without a valid lifeos token
- **THEN** the API returns 401

### Requirement: Per-user timezone

An authenticated lifeos user SHALL have a timezone (default `Asia/Taipei`) and be
able to set it; all reminder time-of-day evaluation SHALL use that timezone.

#### Scenario: Set a valid timezone
- **WHEN** the user PUTs a valid IANA timezone
- **THEN** it is saved

#### Scenario: An invalid timezone is rejected
- **WHEN** the user PUTs a timezone that is not a valid IANA zone
- **THEN** the API returns 400

### Requirement: Deliver due medication reminders once per occurrence

A per-minute scheduler SHALL, for each enabled schedule, determine in the user's
timezone whether the current local time matches one of the schedule's times on an
active day (weekday selected AND the every-N-weeks interval is on, where the interval
is measured in **anchor-relative 7-day windows** from `anchor_date`), and SHALL deliver
that reminder to the user's subscribed devices as a Web Push — **exactly once** per
schedule/day/time even across repeated ticks.

#### Scenario: A due reminder is delivered
- **WHEN** the current local time matches a schedule time on an active weekday and week
- **THEN** a Web Push carrying the schedule's label is sent to each of the user's subscriptions

#### Scenario: A reminder is not delivered twice
- **WHEN** the scheduler runs again for the same schedule/day/time (a repeated or overlapping tick)
- **THEN** no second push is sent for that occurrence

#### Scenario: Inactive day or interval does not fire
- **WHEN** today's weekday is not in `days_of_week`, or the every-N-weeks interval is off for this week, or the anchor date is in the future, or the schedule is disabled
- **THEN** no reminder is produced for that schedule

#### Scenario: A user with no subscription is skipped, not failed
- **WHEN** a due reminder belongs to a user who has no push subscription
- **THEN** the occurrence is recorded as skipped and no delivery is attempted

#### Scenario: A reminder whose every delivery fails is recorded as failed, not sent
- **WHEN** a due reminder's user has subscriptions but every push send fails (a transient error)
- **THEN** the occurrence is recorded as failed (distinct from sent), so the lost reminder is observable rather than mislabeled delivered

#### Scenario: A late tick after midnight still delivers a just-missed time once
- **WHEN** a scheduled time late in the day is missed and the next tick runs just after midnight (within the look-back)
- **THEN** the reminder is delivered exactly once, keyed to the day the time belonged to

#### Scenario: A gone subscription is pruned
- **WHEN** delivering a reminder, the push service reports a subscription gone (404/410)
- **THEN** that subscription is deleted
