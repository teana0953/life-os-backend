## MODIFIED Requirements

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
