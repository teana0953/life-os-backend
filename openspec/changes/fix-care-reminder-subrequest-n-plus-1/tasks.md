## 1. Subrequest budget primitives

- [ ] 1.1 Move `FREE_PLAN_SUBREQUEST_LIMIT = 50` from `src/adapters/http/routes/screen-sections.ts` into `src/shared/db/subrequest-budget.ts`, re-export it from `screen-sections.ts`, and verify `npm run typecheck` passes and the existing `health-overview` / `home-summary` tests still pass unchanged.
- [ ] 1.2 Add `remainingSubrequestBudget(): number | null` to `src/shared/db/subrequest-budget.ts` (`null` outside a scope) and verify with a unit test in `test/shared/db/` that it returns `null` unscoped, the full limit at the start of a scope, and decreases as `recordSubrequest()` is called.

## 2. Batch reads on the occurrence repository

- [ ] 2.1 Add `listByUserAndDate(userId, localDate)` and `listPastUnloggedForUser(userId, todayLocalDate)` to `CareOccurrenceRepository` in `src/contexts/notifications/domain/care-occurrence.ts`, documenting that `listPastUnloggedForUser` is the user-scoped form of `listPastUnlogged`; verify `npm run typecheck` fails until every implementer is updated, then passes.
- [ ] 2.2 Implement both methods in `src/contexts/notifications/adapters/drizzle-care-occurrence-repository.ts` as single statements (`listPastUnloggedForUser` reusing the existing `LEFT JOIN care_log ... IS NULL` shape, filtered on `care_occurrence.user_id`); verify with new cases in `test/contexts/notifications/adapters/drizzle-care-occurrence-repository.test.ts`.
- [ ] 2.3 Add PGlite DB-level coverage in `test/db/` proving each new method returns exactly the rows the per-slot reads returned for that user and day, and excludes another user's rows, another day's rows, and already-logged slots (spec: "Batched reads return exactly what the per-slot reads returned"); verify `npm test` passes.

## 3. Decouple reads from the schedule count

- [ ] 3.1 Rewrite `buildSlotSnapshots` in `src/contexts/notifications/application/run-care-day.ts` to issue exactly three reads (active schedules, `listByUserAndDate`, `careLogRepo.listByUserAndDate`) and index by `(careScheduleId, timeOfDay)` in memory; verify with a counting-fake test in `test/contexts/notifications/application/run-care-day.test.ts` asserting the read count at N=25 equals the count at N=1 **and** equals the literal 3.
- [ ] 3.2 Rewrite `dispatchDueRounds` to take the same three batch reads plus one `subscriptionRepo.listByUser` for the whole round, passing the indexed maps and the subscription list into `dispatchSlot` instead of letting it read per slot; verify with a counting-fake test asserting the read count for a round with nothing due at N=25 equals the count at N=1 **and** equals the literal 4.
- [ ] 3.3 Rewrite `markMissedForUserDay` to use `listPastUnloggedForUser` once instead of a per-schedule `listPastUnlogged`, keeping the "enabled schedules only" filter in the application layer; verify with a counting-fake test asserting the read count at N=25 equals the count at N=1 **and** equals the literal 2, and that the same slots are marked missed as before.
- [ ] 3.4 Mutation-verify tasks 3.1–3.3: revert each batched read to its per-schedule loop one at a time, confirm the intended counting assertion (not an unrelated one) goes red, restore, and record which assertion failed for each.

## 4. Budget scope inside the workflow steps

- [ ] 4.1 Wrap every `step.do` callback in `src/contexts/notifications/adapters/care-reminder-loop.ts` in `withSubrequestBudget(FREE_PLAN_SUBREQUEST_LIMIT, ...)` via one local helper used by all six steps; verify with a test in `test/contexts/notifications/adapters/care-reminder-loop.test.ts` that `remainingSubrequestBudget()` is non-null inside each step body and that each step starts with a full budget of its own.
- [ ] 4.2 Verify the brake actually engages: a test in which a step's budget is consumed and a transient retryable read then fails asserts the read is not retried and the refusal is logged (spec: "A retry inside a reminder day is refused once the budget is gone"), plus a test asserting a failing write is still never retried.
- [ ] 4.3 Mutation-verify 4.1: remove the `withSubrequestBudget` wrapper and confirm the per-step budget tests go red.

## 5. Budget-aware dispatch loop

- [ ] 5.1 Sort the round's slots by `timeOfDay` ascending in `dispatchDueRounds` and, before each slot, compare `remainingSubrequestBudget()` against that slot's worst case (4 writes + `subscriptions.length` sends + 1 reserve), stopping the loop and logging `deferred N slots` when it does not fit; verify with a test that no further slot is claimed once the budget is short and that the deferred slots are still due (unclaimed) afterwards.
- [ ] 5.2 Verify earliest-first: with a budget covering only some of several simultaneously-due slots, assert the dispatched ones are those with the earliest `timeOfDay`.
- [ ] 5.3 Verify the deferred slots dispatch on the next wake — a follow-up round with budget restored delivers them — and that `planNextWake` schedules that wake immediately rather than a nag interval later.

## 6. Failure surfacing

- [ ] 6.1 Wrap `dispatchSlot`'s post-claim body in a try/catch that best-effort records `recordAttempt({ outcome: "failed", detail: <truncated error chain> })` and rethrows; verify with a test that a throw after a won claim leaves the occurrence with `lastSendOutcome === "failed"` and a non-empty detail carrying no endpoint or key material.
- [ ] 6.2 Replace `dispatchDueRounds`'s silent per-schedule `catch {}` with a catch that logs the schedule id and `describeErrorChain(err)`; verify with a test asserting the log is emitted and that the remaining slots in the round are still dispatched.
- [ ] 6.3 Verify the best-effort case: when both the dispatch and the failure-recording write throw, the round continues with the remaining slots and the occurrence is left as an abandoned claim for section 7 to pick up.

## 7. Abandoned-claim retry floor

- [ ] 7.1 Add `ABANDONED_CLAIM_RETRY_MINUTES = 2` and a `lastAttemptAt !== null && lastSendOutcome === null` branch in `nextDueAt`, with a comment recording why 2 (Workers CPU ceiling vs. the measured ten-minute-late 16:15 reminder); verify with tests that such an occurrence is due at `lastAttemptAt + 2min` regardless of `nagIntervalMinutes`, is not due before it, and that `failed` / `expired` / `no_subscriptions` timings are unchanged.
- [ ] 7.2 Verify the derived lease still lets the retry actually claim: a test asserting `claimAttempt` succeeds at exactly the two-minute boundary and fails one second before it, including in `test/db/care-occurrence-claim.test.ts` against the real SQL.

## 8. Orphan retirement

- [ ] 8.1 In `dispatchDueRounds`, retire occurrences from the day's batch whose `(careScheduleId, timeOfDay)` matches no active slot for the day and whose `lastNotifiedAt` is `null`, by `careLogRepo.upsertIfAbsent({ status: "missed", ... })` on their own slot key, subject to the same budget check as 5.1; verify with a test reproducing the measured case (schedule moved 16:05 → 16:15 mid-day) that the 16:05 slot gets a `missed` log the same day.
- [ ] 8.2 Verify the exclusions: an orphan with `lastNotifiedAt` set is left alone, an orphan is never dispatched (no push sent for it), and an orphan the user already answered `done`/`skipped` keeps that answer.

## 9. Whole-change verification

- [ ] 9.1 Run `npm run typecheck` and `npm test` (and `TZ=UTC npm test` for the date-sensitive care tests) and confirm both are green with the full "All tests passed" line, not merely the absence of red.
- [ ] 9.2 Re-run the section 3, 4, 5 and 8 mutation checks together as a final pass and confirm every guard added by this change fails when the behaviour it guards is reverted.
- [ ] 9.3 Confirm the untouched invariants still hold: `retry-fetch.ts` is unmodified, no schema migration was added, and no HTTP route's query count changed (`git diff --stat` review).
- [ ] 9.4 Run `openspec validate fix-care-reminder-subrequest-n-plus-1 --strict` and confirm it passes (the two pre-existing red changes, `add-push-delivery-ack` and `replace-cron-with-workflows`, stay untouched).
