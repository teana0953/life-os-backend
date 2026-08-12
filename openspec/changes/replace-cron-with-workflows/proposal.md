## Why

The per-minute Cron dispatch tick (add-medication-reminders/design.md, later renamed
`run-care-tick`) wakes the Worker — and the Neon database behind it — 1,440 times a
day regardless of how many reminders are actually due, which defeats Neon's
autosuspend and keeps the compute billed as always-on. Cloudflare Workflows lets one
long-lived instance per (user, local day) `sleepUntil` its own next due instant
instead, so Neon only wakes for genuinely due rounds (~8-10 times/day/user) plus one
daily repair cron. This also **directly fixes** two gaps the original design
explicitly deferred: D6 relied on "Cron never runs concurrently" for exactly-once
delivery — a premise Workflows' at-least-once step replay breaks — and D1's per-minute
model gave every reminder an implicit ≤1-minute latency floor that a sleep-based model
has to earn back deliberately.

## What Changes

- **One Workflow instance per (user, local day)**, deterministic id
  `care-day:{userId}:{localDate}` (`CareReminderWorkflow`): marks yesterday's
  unanswered slots missed, then loops `plan-next-wake → sleepUntil → dispatch-due-rounds`
  until local midnight, then spawns tomorrow's instance (chained). A downgraded daily
  cron (`ensureCareDayInstances`, ~00:05 Asia/Taipei) is a repair-only safety net: it
  creates today's instance for every user with an enabled schedule, silently no-op'ing
  on the id collision that means one already exists — self-heals a broken chain within
  24h.
- **Atomic leased claim** (`CareOccurrenceRepository.claimAttempt`) replaces D6's
  informal "Cron won't overlap" assumption: `last_attempt_at IS NULL OR <= at -
  leaseMinutes`, so a Workflows step replay of the same round can't double-send, while
  an abandoned claim (crashed after claiming, before recording an outcome) is still
  retriable once its lease elapses — see Key Decisions D6'' below for why this is a
  *leased* claim, not a plain compare-and-swap.
- **`FIRST_FIRE_GRACE_MINUTES = 10`** (a slot's first materialization may run up to 10
  minutes late) is now a distinct concept from `RETRY_INTERVAL_MINUTES = 10`
  (nag/retry floor and claim-lease length) — same number, deliberately kept as two
  separate gates that must never be applied to the same code path (see D11'' below).
- **`shared-kernel/reminder-clock.ts`** gains `utcInstantFor` (local→UTC, DST-aware:
  gap → first legal instant after it, overlap → first occurrence) and
  `nextLocalMidnightInstant` — used ONLY to compute how long an instance should sleep;
  every *due* decision still compares local wall-clock values, recomputed fresh on
  every wake (D1 unchanged in spirit, extended rather than replaced).
- Care schedule create/update/delete, `PUT /api/user/timezone`, and a new push
  subscription now best-effort restart today's instance (`CareDayInstanceManager`) so
  a change takes effect within seconds instead of waiting for the instance's own next
  wake.
- `run-care-tick.ts` is deleted; its logic is split into `run-care-day.ts` (pure
  application functions: `dispatchDueRounds`, `planNextWake`, `markMissedForUserDay`)
  behind a thin `CareReminderWorkflow` orchestrator.

No schema migration — `claimAttempt` reuses the existing `last_attempt_at` column.

## Capabilities

### Modified Capabilities

- `medication-reminders` (and every category built on the shared `care_*` scheduling
  core): delivery is now driven by per-user Workflow instances instead of a global
  per-minute Cron tick. User-facing behavior is equivalent or better (near-instant
  effect on schedule/timezone/subscription changes); the only observable difference is
  a `no_subscriptions` slot now retries at a 10-minute floor instead of every tick,
  compensated by the new subscribe-triggered instant restart.
