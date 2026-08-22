## 1. The opt-in header

- [x] 1.1 In `src/adapters/http/routes/assistant-key.ts`, add
  `ASSISTANT_HEALTH_HEADER = "X-Assistant-Health"` and a resolver that returns
  `true` only for the exact value `on` — verify with unit tests covering
  absent, empty, `on`, `ON`/`true`/`1`, and a typo, all but `on` returning
  `false` (design.md — fail closed).
- [x] 1.2 Add the header to `allowHeaders` in `src/adapters/http/app.ts:252`
  next to `GEMINI_KEY_HEADER` — verify with a test that sends an `OPTIONS`
  preflight and asserts the header is named in
  `access-control-allow-headers` (spec: "The browser preflight allows the
  opt-in header"; deleting the entry must turn that test red).

## 2. Health in the tool context

- [x] 2.1 In `src/contexts/assistant/application/tools.ts`, add the single
  optional `health` field to `ToolContext` holding the eight ports the nine
  use cases need (daily targets, meals, water, bowel, vitals, exercise,
  menstrual, body profile) — verify `npm run typecheck` passes and that no
  `healthEnabled` boolean exists (design.md: one field, not two).
- [x] 2.2 Replace the exported `ASSISTANT_TOOLS` constant with
  `assistantTools(context)` returning the finance list, plus the nine health
  tools when `context.health` is present — verify two whole-list `toEqual`
  assertions in `test/contexts/assistant/tools.test.ts`, one per state,
  matching the existing "asserted whole, never `not.toContain`" style.
- [x] 2.3 Update the file-header comment at `tools.ts:22-26` to state the new
  rule (health reachable only on explicit per-request opt-in; care and
  reminder records never) — verify by reading it back against
  specs/ai-assistant/spec.md; the old blanket sentence must be gone.
- [x] 2.4 Update `src/contexts/assistant/application/converse.ts` to call
  `assistantTools(context)` once and pass the result to every model turn —
  verify existing converse tests still pass.

## 3. The nine health tools

- [x] 3.1 Add `get_diet_targets(day)` (wraps `getDailyTargetWithRemaining`) and
  `list_meals(day)` (wraps `getDayMeals`) cases to `runTool`, defaulting `day`
  to `context.today` — verify with tests asserting the use case receives
  `context.userId` and the defaulted day.
- [x] 3.2 Add `get_water_day(day)`, `get_bowel_day(day)`, `get_exercise_day(day)`
  and `get_vitals_day(day)` cases, same day default — verify with tests per
  tool asserting the caller's own id and the defaulted day.
- [x] 3.3 Add `get_weight_goal()` (wraps `getWeightGoal`, needs body profile +
  vitals ports) — verify with a test asserting the caller's own id reaches
  both ports.
- [x] 3.4 Add `get_vitals_range(from,to)` with a `VITALS_RANGE_MAX_DAYS = 31`
  clamp that moves `from` forward when the requested span is wider — verify
  with tests for a within-bound span passed through untouched and an
  over-bound span clamped to 31 days (spec: "A vitals range wider than the
  server allows"; removing the clamp must go red).
- [x] 3.5 Add `get_menstrual_overview()` with a `MENSTRUAL_CYCLE_MAX = 12`
  clamp taking the most-recent cycles from the ascending list, keeping the
  use case's statistics untouched — verify with a test using more than 12
  recorded cycles asserting exactly the last 12 come back and the statistics
  are unchanged (spec: "A long menstrual history").
- [x] 3.6 Write the tool descriptions so each names its own server bound where
  one exists — verify the two clamped tools' descriptions mention the bound.

## 4. The refusal that holds where tools run

- [x] 4.1 In each of the nine health cases in `runTool`, return the existing
  `unknown tool: <name>` answer when `context.health` is absent (per-case, not
  one name-list guard — design.md) — verify with a test that calls every
  health tool name against a health-off context and asserts the unknown-tool
  answer plus that no repository was reached (the `unusable` Proxy in the
  existing test already throws on any access).
- [x] 4.2 Confirm the refusal message is byte-identical to the one an
  unrecognised name gets — verify with a test comparing the two answers, so a
  future "not permitted" message cannot leak that the tool exists.

## 5. The prompt's two branches

- [x] 5.1 Branch `systemPrompt` in `converse.ts` on `context.health`, rewriting
  both the visibility sentence and the out-of-scope sentence in the health-on
  branch (health and diet visible; care and reminder records still not) and
  leaving the health-off branch's wording as it is today — verify with two
  tests asserting the composed prompt string in each state.
- [x] 5.2 Name the tests after what they guard (the prompt is the only lever;
  the server never sees the model's output) — verify the test names and
  comments say so, so a green prompt test is not later read as an enforced
  block.

## 6. Wiring

- [x] 6.1 Extend `AssistantHandlerOptions` in
  `src/adapters/http/routes/assistant.ts` with the eight health repositories
  and build `context.health` only when the header resolver returns true —
  verify with route tests for both states.
- [x] 6.2 Pass the health repositories from `createApp` into
  `createAssistantHandler` in `src/adapters/http/app.ts:519` — verify
  `npm run typecheck` and the full route test suite pass.
- [x] 6.3 Add a route-level test that a request without the header cannot reach
  a health record even when it names a health tool, and one that a request
  with the header can — verify both against the scripted fake model client in
  `test/adapters/http/assistant.test.ts`.

## 7. Verification

- [x] 7.1 Run `npm test` and `npm run typecheck` — both clean.
- [x] 7.2 Mutation-verify each guard, one at a time, restoring the file after
  each and confirming the specific test that should fail is the one that
  fails: invert the header check; drop one health tool from the open list and
  one from the closed list's expected names; delete one health case's
  refusal in `runTool`; delete each of the four prompt sentences; remove each
  clamp; remove the header from `allowHeaders`. Every one must go red.
- [x] 7.3 Run `npx openspec validate assistant-health-read --strict` — passes.
