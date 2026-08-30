## ADDED Requirements

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

#### Scenario: A round out of budget defers rather than half-claims
- **WHEN** a round has already consumed its budget and further slots are still due
- **THEN** no further slot is claimed or dispatched, the deferral is logged, and the deferred slots are still due — and are dispatched — on the next wake

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
active slots for that day — SHALL NOT be left with no outcome until the next day.

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
