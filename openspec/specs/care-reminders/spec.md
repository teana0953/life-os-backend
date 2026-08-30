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
of 0 SHALL deliver exactly once. A nag window SHALL produce at most one *successful* delivery
per slot — a window may make more than one attempt when an attempt fails.

A slot SHALL count as delivered only when at least one push actually succeeded. A round in
which every push failed SHALL NOT count as delivered, and SHALL be retried — no faster than a
fixed retry interval, so a persistent failure cannot turn into a per-minute retry loop. Each
attempt SHALL record when it ran, how it turned out, and — when it failed — the sender's short
diagnostic, so that "not delivered" can be told apart from "delivered but not received" without
any external logging.

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

#### Scenario: A round where every push failed is not counted as delivered
- **WHEN** the slot has subscriptions but every push fails
- **THEN** the slot is not marked delivered, so it is retried rather than silently treated as sent

#### Scenario: A round where every subscription was gone is not counted as delivered
- **WHEN** every one of the user's subscriptions is reported gone and pruned
- **THEN** the slot is not marked delivered and the attempt records that it was the subscriptions being gone — so the next round, which now has none, is distinguishable from a send failure

#### Scenario: A retry floor applies only after a round that did not deliver
- **WHEN** a slot delivered successfully earlier and a later nag round fails entirely
- **THEN** the retry floor governs the next attempt, rather than the slot retrying every tick because its last *successful* delivery keeps satisfying the nag interval

#### Scenario: A partially successful round counts as delivered
- **WHEN** at least one of the user's subscriptions receives the push and others fail
- **THEN** the slot counts as delivered — the user already got it — and nagging resumes from its normal interval

#### Scenario: A persistently failing slot retries at a floor interval
- **WHEN** delivery keeps failing, including for a schedule whose `nag_interval_minutes` is 0
- **THEN** retries are spaced by at least a fixed retry interval, rather than repeating every tick

#### Scenario: Every attempt is recorded for diagnosis
- **WHEN** a delivery attempt runs
- **THEN** the attempt's time and outcome are recorded on the slot, with the sender's short diagnostic when it failed and none when nothing failed, and with no endpoint or key material

#### Scenario: A repeated no-subscriptions outcome is not re-recorded every tick
- **WHEN** a due slot finds the user still has no subscriptions and the previous attempt already recorded exactly that
- **THEN** it is not recorded again, so a slot that stays subscription-less for a whole day costs one write rather than one per minute
- **AND** this applies only to having no subscriptions: a failed attempt is always recorded, because its recorded time is what the retry floor is measured from — skipping it would freeze that time and collapse the floor back into a per-tick retry loop

#### Scenario: Having no subscriptions is distinguishable from failing to send
- **WHEN** the slot is due but the user has no subscriptions
- **THEN** the attempt is recorded as such, the slot is still not marked delivered, and the next tick after a subscription exists delivers immediately — the slot never waits out a nag interval or a retry floor for a delivery that never happened

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

### Requirement: A reminder day's database reads do not grow with the number of schedules

The work a reminder day performs SHALL stay inside the platform's per-invocation subrequest
limit no matter how many schedules a user has. Concretely, the number of database *reads*
issued to plan a wake, to run one dispatch round, and to mark past slots missed SHALL be a
fixed constant, independent of how many schedules the user owns and of how many of them are
active on the day. Adding a schedule SHALL NOT add a read to any of those three operations.

Per-slot *writes* are exempt and SHALL remain per slot: materializing a slot, claiming its
attempt, recording its outcome, and logging a missed slot each identify exactly one slot, and
batching them into one statement would make a partial failure impossible to attribute. Reads
are batched; writes are not.

#### Scenario: Planning a wake costs the same for one schedule and for many
- **WHEN** a wake is planned for a user with one active schedule, and again for a user with twenty-five active schedules on the same day
- **THEN** both plans issue the same number of database reads

#### Scenario: A dispatch round costs the same for one schedule and for many
- **WHEN** a dispatch round runs for a user with one active schedule, and again for a user with twenty-five active schedules of which none is yet due
- **THEN** both rounds issue the same number of database reads

#### Scenario: A dispatch round costs the same even when every slot is due but already answered
- **WHEN** a dispatch round runs for a user with one active schedule, and again for a user with twenty-five active schedules, all of them due and already answered for the day
- **THEN** both rounds issue the same number of database reads, and no slot is claimed or dispatched

#### Scenario: Marking past slots missed costs the same for one schedule and for many
- **WHEN** past unanswered slots are marked missed for a user with one enabled schedule, and again for a user with twenty-five enabled schedules
- **THEN** both passes issue the same number of database reads, and the same slots are marked missed in each case

#### Scenario: A round reads the user's subscriptions once
- **WHEN** several of a user's slots are due in the same round
- **THEN** the user's push subscriptions are read once for the round, not once per slot

#### Scenario: Batched reads return exactly what the per-slot reads returned
- **WHEN** a day's occurrences, logs, and past unanswered occurrences are read in batch
- **THEN** the result contains every row the per-slot reads would have returned for that user and day, and no row belonging to another user, another day, or an already-answered slot

### Requirement: A round stops dispatching before it exhausts the subrequest limit

A reminder round SHALL track its own consumption of the platform's per-invocation subrequest
budget, and SHALL NOT begin dispatching a further slot when the remaining budget cannot cover
that slot's dispatch. Slots not dispatched for this reason SHALL be left unclaimed, so that the
next wake can dispatch them normally, and the deferral SHALL be logged. Slots SHALL be
considered in scheduled-time order, earliest first, so the slot closest to losing its
first-fire window is served first.

A retry of a transient read failure SHALL be subject to the same budget on this path: when the
round's budget is exhausted, the read is not retried. This holds inside every step of a
reminder day, and each step SHALL have its own budget, because each step is a separate
invocation with its own limit.

A slot's entry-gate reserve SHALL NOT scale with its subscription count: it SHALL be a fixed cost
that decides only whether the slot is worth claiming at all, never a per-subscription estimate of
the whole fleet's worst case. (A fleet-scaled entry reserve was tried and reverted: it made a large
subscription fleet — `subscriptions.length` past roughly 21 on a 50-request step — unaffordable on
EVERY wake, forever, because every wake starts from the same fresh budget; that is a permanent,
silent drop of the exact kind this change exists to remove, reached from the conservative
direction instead of the cheap one, and it does not self-heal because a stale subscription is only
pruned on an actual send. See `design.md` D4.)

Once a slot is claimed, its dispatch to individual subscriptions SHALL itself stay inside the
remaining budget: before each subscription's send, the round SHALL confirm there is still room for
that send's worst case (the send itself, plus a possible `subscriptionRepo.deleteByEndpoint` if it
comes back expired) AND for the outcome-recording write that follows the dispatch loop. When there
is not, the loop SHALL stop sending to the remaining subscriptions rather than either being claimed
in the first place with no chance of finishing, or continuing until the platform itself cuts the
round off. A slot that stops early this way SHALL still have its attempt recorded — the reserved
room for that write SHALL NOT itself be spent by the per-send check. Subscriptions the loop did not
reach are not retried within the same wake; they wait for the slot's ordinary next-due cadence.

#### Scenario: A round out of budget defers rather than half-claims
- **WHEN** a round has already consumed its budget and further slots are still due
- **THEN** no further slot is claimed or dispatched, the deferral is logged, and the deferred slots are still due — and are dispatched — on the next wake

#### Scenario: A large fleet is claimed and delivered to on a normal budget, never permanently deferred
- **WHEN** a user has enough push subscriptions that the OLD fleet-scaled reserve would have exceeded what any wake's budget could ever cover
- **THEN** the slot is still claimed on the ordinary fixed entry-gate cost, and every reachable subscription in the fleet is sent to when the round's budget is otherwise fresh

#### Scenario: A slot with more subscriptions than the remaining budget can reach delivers partially and records the result
- **WHEN** a claimed slot has more subscriptions than the round's remaining budget can afford to send to
- **THEN** the round sends to as many subscriptions as it can afford, stops before exceeding budget on the rest, logs how many of the fleet it reached, and records the slot's attempt outcome rather than leaving it an abandoned claim

#### Scenario: Deferral serves the earliest slot first
- **WHEN** several slots are due in one round and the budget covers only some of them
- **THEN** the slots with the earliest scheduled times are the ones dispatched

#### Scenario: A retry inside a reminder day is refused once the budget is gone
- **WHEN** a transient, retryable read fails inside a reminder day's step and that step's budget is already consumed
- **THEN** the read is not retried, and the refusal is logged

#### Scenario: Each step gets its own budget
- **WHEN** one step of a reminder day consumes most of its budget
- **THEN** the next step starts with a full budget of its own

#### Scenario: Writes are still never retried
- **WHEN** a write fails transiently anywhere on this path
- **THEN** it is not retried, regardless of remaining budget

### Requirement: A dispatch that fails after claiming its attempt is recorded and logged

Once a slot's attempt has been claimed, the slot SHALL NOT be able to end the round in a state
that reports nothing. When dispatching throws after the claim is won, the slot's attempt SHALL
be recorded as failed with a short non-credential diagnostic, and the failure SHALL be logged
with the schedule it belongs to. Isolation is preserved: one slot's failure SHALL NOT abort the
other slots in the round.

A round in which one or more slots failed SHALL NOT be indistinguishable, in the logs and in
the stored data, from a round in which every slot succeeded.

#### Scenario: A throw after the claim is recorded on the slot
- **WHEN** dispatching a slot throws after its attempt has been claimed
- **THEN** the slot's attempt is recorded as failed with a short diagnostic, so it is not left with an attempt time and no outcome

#### Scenario: A failing slot does not abort the round
- **WHEN** one slot's dispatch throws and other slots in the same round are due
- **THEN** the other slots are still dispatched

#### Scenario: A swallowed failure is logged with its schedule
- **WHEN** a slot's dispatch fails for any reason
- **THEN** the failure is logged with the schedule's identifier and the error chain, and no endpoint or key material

#### Scenario: Recording the failure is itself best-effort
- **WHEN** dispatching throws and recording the failure also fails
- **THEN** the round still continues with the remaining slots, and the slot is picked up by the abandoned-claim retry instead

### Requirement: An abandoned claim is retried on a short floor

An occurrence that has an attempt time but no recorded outcome — a claim that was won by a
round that then died before recording anything — SHALL become due again after a short fixed
floor measured in minutes, NOT after the failed/expired retry floor and NOT after the
schedule's nag interval. This floor SHALL also be the lease used when re-claiming such an
occurrence, so the two can never disagree about when a retry is permitted.

The floor SHALL be long enough that a round still genuinely in flight is not re-claimed
underneath itself, and short enough that a medication reminder is not delayed by the ten-minute
failed-round floor for a round that never actually reported anything.

#### Scenario: An abandoned claim is due again in minutes
- **WHEN** an occurrence has an attempt time, no recorded outcome, and the short floor has elapsed
- **THEN** it is due, and it is claimable — regardless of the schedule's nag interval

#### Scenario: An abandoned claim is not retried before the floor
- **WHEN** an occurrence has an attempt time, no recorded outcome, and the short floor has not yet elapsed
- **THEN** it is not due and is not claimed, so a round still in flight is not duplicated

#### Scenario: A recorded failure keeps the longer floor
- **WHEN** an occurrence has a recorded `failed`, `expired`, or `no_subscriptions` outcome
- **THEN** its retry timing is unchanged by this requirement

### Requirement: An orphaned occurrence from a same-day schedule edit is resolved the same day

Changing a schedule's time of day part-way through a day leaves behind an occurrence at the old
time that no later read keyed on the schedule's current time will ever see again. Such an
occurrence — one belonging to the current day whose slot is no longer among the schedule's
active slots for that day, AND whose schedule is still active today (not disabled or deleted) —
SHALL NOT be left with no outcome until the next day.

An orphan whose schedule was disabled mid-day (rather than merely having its time of day changed)
is exempt from the same-day requirement above: the day's read batch this requirement is built on
has no `doseQuantity` for such a schedule (`design.md` D7), and resolving it same-day would cost
a per-orphan read that reintroduces the per-schedule cost the rest of this change removes. This is
a pre-existing gap this change does not close: the ordinary missed-marking sweep only ever
considers enabled schedules, so such an orphan is left with no outcome for as long as its
schedule stays disabled — it resolves only if and when the schedule is re-enabled. A *deleted*
schedule does not extend this gap: `care_occurrence` cascades on its schedule's deletion (`design.md`
D7), so deleting the schedule deletes the orphan occurrence row with it — there is no row left
to be "resolved" or "unresolved" either way.

An orphaned occurrence that was never delivered SHALL be written off as `missed` for its own
slot when it is detected, using the same never-clobber write as every other missed marking, so
an answer already recorded by the user is preserved. An orphaned occurrence that WAS delivered
SHALL be left alone: the user received that reminder and may still answer it, and the ordinary
end-of-day missed marking already covers it.

An orphaned occurrence SHALL NOT be dispatched at the old time — the user moved that reminder
deliberately.

#### Scenario: The old slot is written off after a same-day time change
- **WHEN** a schedule's time of day is changed from an earlier to a later time on the same day, and the earlier slot's occurrence was never delivered
- **THEN** the earlier slot is recorded as `missed` that same day, rather than staying with no outcome until the next day

#### Scenario: An orphaned slot is never sent at its old time
- **WHEN** an occurrence exists for a time that is no longer one of the schedule's active slots for the day
- **THEN** no push is sent for it

#### Scenario: A delivered orphan is left for the ordinary end-of-day marking
- **WHEN** the orphaned occurrence had already been delivered before the schedule was edited
- **THEN** it is not written off on the spot, and the user can still answer it

#### Scenario: Writing off an orphan never clobbers a real answer
- **WHEN** the user has already answered the orphaned slot as done or skipped
- **THEN** that answer stands and is not overwritten

#### Scenario: A disabled schedule's orphan is not resolved same-day
- **WHEN** a schedule is disabled part-way through the day, leaving behind an undelivered occurrence for a slot that is no longer active
- **THEN** that occurrence is not written off as `missed` that same day, and stays that way — with no outcome — for as long as the schedule remains disabled; it is written off only once the schedule is re-enabled and the ordinary missed-marking sweep next runs

#### Scenario: A deleted schedule's orphan occurrence is deleted with it, not left unresolved
- **WHEN** a schedule is deleted part-way through the day, leaving behind an undelivered occurrence for a slot that is no longer active
- **THEN** the cascading foreign key removes that occurrence's row along with the schedule — there is no orphan record left for any later sweep to resolve
