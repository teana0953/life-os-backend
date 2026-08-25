## 1. Care in the tool context

- [x] 1.1 In `src/contexts/assistant/application/tools.ts`, add `careItems:
  CareItemRepository`, `careLogs: CareLogRepository` and `users:
  UserRepository` to the existing `HealthPorts` interface (D1 — one optional
  field, no `care?` field and no `careEnabled` boolean) — verify `npm run
  typecheck` passes and that grepping `tools.ts` finds no second optional
  ports field.
- [x] 1.2 Update the `tools.ts` file-header comment: the sentence "care and
  reminder records are reachable in neither state" is replaced by one saying
  health, diet and care records are reachable only on the caller's per-request
  opt-in, and reminder/push records in neither state — verify by reading it
  back against `specs/ai-assistant/spec.md`; the old sentence must be gone.

## 2. The three care tools

- [x] 2.1 Add a `CARE_TOOLS` list holding `get_care_today` (no parameters),
  `get_care_range` (`from`, `to`) and `list_care_items` (`category`), and
  return it from `assistantTools` when `context.health` is present — verify
  the two whole-list `toEqual` assertions in
  `test/contexts/assistant/tools.test.ts` are updated, one per state, keeping
  the existing "asserted whole, never `not.toContain`" style (spec: "The list
  matches what will run").
- [x] 2.2 Write each tool's description to name its own server bound where one
  exists, following the vitals-range wording — verify `get_care_range`'s
  description states the maximum span and that a wider request comes back
  covering only that.
- [x] 2.3 Add the `get_care_today` case to `runTool`, calling `getCareToday`
  with `{ userRepo: context.health.users, careItemRepo:
  context.health.careItems, careLogRepo: context.health.careLogs }`,
  `context.userId` and `new Date()` (D2 — the use case resolves the caller's
  local date from their timezone; do not derive it from `context.today`) —
  verify with a test asserting the caller's own id reaches the use case and
  that the answer carries the day's slots.
- [x] 2.4 Add the `list_care_items` case, wrapping `listCareItems` with
  `context.userId` and the optional category — verify with a test that an
  absent `category` returns every item and a named one returns only that
  category's (spec: "What is scheduled, not only what happened").
- [x] 2.5 Reject an unrecognised `category` with `{ error: ... }` naming the
  four valid values, following `search_foods`'s empty-query answer (D7) —
  verify with a test asserting a bogus category returns the error and that
  **no** repository is reached, so the filter is never silently dropped.

## 3. The care range and its clamp

- [x] 3.1 Add the `get_care_range` case wrapping `getCareRange`, with `to`
  defaulting to `context.today` and `from` defaulting to the earliest allowed
  day, reusing the existing `isValidDay`/`dayArg`/`addDays` helpers — verify
  with tests for both defaults and for a from/to pair the model supplied.
- [x] 3.2 Add `const CARE_RANGE_MAX_DAYS = VITALS_RANGE_MAX_DAYS;` (D3 — one
  number, two names) and clamp `from` forward when the requested span is
  wider, answering bounded rather than refusing — verify with tests for a
  within-bound span passed through untouched and an over-bound span clamped
  to the maximum ending at `to` (spec: "A care range wider than the server
  allows"; deleting the clamp must go red).

## 4. The projection

- [x] 4.1 Add a local care-slot projection in `tools.ts` (snake_case, mirroring
  `foodCandidate`; not an import from `src/adapters/http/routes/care.ts`, which
  would break the dependency rule — D5) carrying category, title, note, dose,
  time of day, local date, status, `done_time` as an ISO string, and dose
  quantity — verify with a test asserting the exact key set of a returned slot.
- [x] 4.2 Apply the same projection to both `get_care_today` and
  `get_care_range` — verify with a test asserting the two produce identical
  slot shapes for the same slot (spec: "The projection SHALL be applied
  identically to every care source").
- [x] 4.3 Add the care-item projection for `list_care_items` — category, title,
  note, dose, stock, stock alert, and per schedule the time of day, repeat
  days, week interval, start/end date, dose quantity and enabled flag —
  verify with a test asserting no `id`, `care_item_id`, `care_schedule_id`,
  `user_id` or `nag_interval_minutes` appears anywhere in the result (spec:
  "Fields a care record does not carry").

## 5. The refusal that holds where tools run

- [x] 5.1 Guard each of the three care cases with `if (!context.health) return
  unknownTool(name);` — per case, not one name-list check (D6) — verify with a
  test calling all three names against an opt-in-off context, asserting the
  unknown-tool answer and that no repository was reached (the existing
  `unusable` Proxy throws on any access).
- [x] 5.2 Confirm the refusal is byte-identical to the answer an unrecognised
  name gets — verify with a test comparing the two strings (spec: "A care tool
  named while the opt-in is off").

## 6. The prompt's two branches

- [x] 6.1 In `src/contexts/assistant/application/converse.ts`, widen the
  opt-in-on visibility and out-of-scope sentences to name care, and change
  "You cannot see care or reminder records" to name reminder and
  push-notification records only; leave the opt-in-off branch's list
  (health, diet, care, reminder) as it stands — verify with the two composed
  whole-prompt assertions in `test/contexts/assistant/converse.test.ts`, one
  per state.
- [x] 6.2 Add the opt-in-on sentence telling the model to report what is
  recorded and scheduled and to decline the medical judgement (D8) — verify
  with a test asserting the sentence is present, named after what it guards
  and commented to say the prompt is not an enforced filter (the server never
  sees the model's output under BYOK).

## 7. Wiring

- [x] 7.1 Extend `AssistantHandlerOptions` in
  `src/adapters/http/routes/assistant.ts` with `careItemRepository` and
  `careLogRepository`, and put them plus the already-present
  `userRepository` into the `health` object built only when
  `resolveHealthOptIn(c)` is true — verify with route tests for both states.
- [x] 7.2 Pass the two care repositories from `createApp` into
  `createAssistantHandler` in `src/adapters/http/app.ts` (both already exist
  as `createApp` options) — verify `npm run typecheck` and the full route
  suite pass.
- [x] 7.3 Add route-level tests against the scripted fake model client in
  `test/adapters/http/assistant.test.ts`: a request without the header cannot
  reach a care record even when it names a care tool, and one with the header
  can. Extend `test/adapters/http/assistant-stubs.ts` with the care stubs the
  handler now needs.

## 8. Verification

- [x] 8.1 Run `npm test` and `npm run typecheck` — both clean.
- [x] 8.2 Mutation-verify each guard one at a time, restoring the file after
  each and confirming the specific test that should fail is the one that
  fails: delete each of the three care cases' opt-in refusal; drop one care
  tool from the open list and from the closed list's expected names; remove
  the range clamp; drop the category validation; remove an omitted identifier
  from the projection (i.e. add `care_item_id` back); delete each changed
  prompt sentence. Every one must go red.
- [x] 8.3 Confirm no care write exists: grep the assistant context for
  `answerCareSlot`, `editCareSlot`, `createCareItem`, `updateCareItem`,
  `deleteCareItem`, `decrementStock` and `Proposal` kinds other than
  `create_transaction` — none may appear (spec: "No care tool writes").
- [x] 8.4 Run `openspec validate assistant-read-care-records --strict` — passes.
