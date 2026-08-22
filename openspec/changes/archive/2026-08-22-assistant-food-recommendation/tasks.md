## 1. The dictionary port in the health bundle

- [x] 1.1 In `src/contexts/assistant/application/tools.ts`, add
  `foodDictionary: FoodDictionaryRepository` to `HealthPorts` — verify
  `npm run typecheck` passes and that no second optional field and no
  `foodEnabled` boolean was introduced (design.md: presence of the one
  `health` field is the whole opt-in).
- [x] 1.2 Add `foodDictionaryRepository` to `AssistantHandlerOptions` in
  `src/adapters/http/routes/assistant.ts` and put it into the
  `resolveHealthOptIn(c) ? { ... }` object beside the other eight ports —
  verify with a route test that a request without the opt-in header builds no
  `health` object at all.
- [x] 1.3 Pass the already-present `options.foodDictionaryRepository` into
  `createAssistantHandler` in `src/adapters/http/app.ts` — verify
  `npm run typecheck` and the full route test suite pass.
- [x] 1.4 Add `foodDictionary: unusable as never` to the `healthPorts` helper
  in `test/contexts/assistant/tools.test.ts` and to the `healthPorts` constant
  in `test/contexts/assistant/converse.test.ts` — verify both suites compile
  and still pass.

## 2. The three tool definitions

- [x] 2.1 Add `list_favorite_foods`, `list_recent_foods(days)` and
  `search_foods(query)` to `HEALTH_TOOLS` — verify by extending **both**
  whole-list `toEqual` assertions in `test/contexts/assistant/tools.test.ts`:
  the three names appear in the health-on list and none appears in the
  health-off list (the whole-list style is the point; `not.toContain` would
  stay green forever).
- [x] 2.2 Write each description to name its own server bound where one exists
  (window and count for `list_recent_foods`, row count for `search_foods`) and
  to say `list_favorite_foods` is the caller's own curated list — verify with
  a test asserting the two bounded tools' descriptions mention their bound,
  matching the existing `get_vitals_range` / `get_menstrual_overview` tests.
- [x] 2.3 Add the three bound constants beside `TRANSACTION_LIST_MAX` with the
  same "the bound is the server's, not the model's" comment:
  `RECENT_FOOD_DAYS_MAX = 30` (also the default window), `RECENT_FOOD_MAX = 30`
  distinct foods, `FOOD_SEARCH_MAX = 20` rows — verify by reading them back
  against design.md; no bound may be inlined at a call site.

## 3. The projection

- [x] 3.1 Add one projection helper in `tools.ts` mapping a `FoodItem` to
  `{ name, staple, meat, fruit, veg, kcal, base_amount, measure_unit }` and
  nothing else — verify with a test that asserts the returned object's keys
  **whole** (`Object.keys(...)` compared with `toEqual`), not by
  `not.toHaveProperty`, so a field added later cannot slip through green.
- [x] 3.2 Verify with a test that feeds a `FoodItem` carrying `id`,
  `ownerUserId`, `carbG`/`proteinG`/`fatG`/`sugarG`/`fiberG` and `createdAt`
  and asserts none of them appears in any of the three tools' results (spec:
  "Fields a candidate does not carry"); adding any one back must go red.

## 4. `list_favorite_foods`

- [x] 4.1 Add the `list_favorite_foods` case to `runTool`, beginning with the
  same per-case `if (!context.health) return unknownTool(name);` the existing
  health cases use, wrapping `listFavoriteFoodItems` with `context.userId` and
  mapping through the projection — verify with a test asserting the use case
  receives the caller's own id and that the result is the projected shape.
- [x] 4.2 Verify with a test that the favourites list is **not** truncated
  (more favourites than `RECENT_FOOD_MAX` all come back) — the list's size is
  the caller's choice, not the model's, and dropping one would make the answer
  silently wrong (design.md).

## 5. `list_recent_foods`

- [x] 5.1 Add the case: clamp `days` into `1..RECENT_FOOD_DAYS_MAX` (default
  `RECENT_FOOD_DAYS_MAX` when absent or not a finite number), call
  `listMealsInRange(userId, addDays(today, -(days - 1)), today)` — verify with
  tests asserting the `from`/`to` passed to the port for: no argument, a
  within-bound `days`, an over-bound `days` clamped to 30, and `0`/negative
  clamped to 1 (spec: "A recent-foods window wider than the server allows").
- [x] 5.2 Fold items to candidates: drop items whose `name` is null or blank,
  drop `unclassified` items — verify with a test whose fixture contains one
  nameless item and one unclassified item alongside a normal one, asserting
  only the normal one comes back; removing either filter must go red, so the
  two must sit on the *different* sides of the distinction the test draws.
- [x] 5.3 Group by trimmed, lowercased name, emitting `times_eaten` (count of
  items in the group) and `last_eaten_day` (the latest day) — verify with a
  fixture where the same food appears on three days with differing spacing,
  asserting one row with `times_eaten: 3` and the **latest** day; changing the
  aggregate to earliest must go red.
- [x] 5.4 Take the per-unit portion, kcal and measure values from the group's
  **most recent** occurrence, never averaged — verify with a fixture where the
  same name was logged with different per-unit portions on two days,
  asserting the newer day's values come back exactly (design.md: an average
  produces a food that never existed).
- [x] 5.5 Sort by `times_eaten` desc, then `last_eaten_day` desc, then name
  asc, then take at most `RECENT_FOOD_MAX` — verify with a fixture of more
  than 30 distinct foods asserting the returned 30 are the most relevant by
  that order and that two foods tying on both keys come back in a
  deterministic name order (spec: "More distinct recent foods than the server
  returns").
- [x] 5.6 Confirm no new method was added to `MealRepository` and no new SQL
  was written — verify by `git diff` over
  `src/contexts/health/domain/meal-repository.ts` and
  `src/contexts/health/adapters/` being empty.

## 6. `search_foods`

- [x] 6.1 Add the case wrapping `searchFoodDictionary(foodDictionary, userId,
  query)`, projecting the rows and slicing to `FOOD_SEARCH_MAX` — verify with
  a test asserting the caller's own id reaches the port and that a port
  returning more than 20 rows yields exactly 20 (spec: "A dictionary search
  matching many foods"; removing the slice must go red).
- [x] 6.2 A missing, non-string or blank `query` returns an error result the
  model can read and retry from — not a thrown error and not a whole-catalogue
  dump — verify with tests for absent, empty-string and whitespace-only
  queries, following the `propose_transaction` bad-argument precedent.

## 7. The refusal holds where tools run

- [x] 7.1 Extend the existing health-off test that calls every health tool
  name against a health-off context so it covers the three new names, and
  assert the answer is byte-identical to the one an unrecognised name gets and
  that no repository was reached (the `unusable` Proxy already throws on any
  access) — verify by deleting one of the three per-case refusals: that test
  must go red (spec: "A food tool named while health is off").
- [x] 7.2 Add a test asserting none of the three tools produces a `proposal`
  and that no write path exists for them — verify against spec: "No food tool
  writes".

## 8. The recommendation rule in the prompt

- [x] 8.1 Add the recommendation sentence to the **health-on branch only** of
  `systemPrompt` in `src/contexts/assistant/application/converse.ts`: read
  `get_diet_targets` for `remaining` first, draw candidates from favourites
  and recently eaten foods, use `search_foods` only when those fall short, and
  present the suggestion as each food group's summed portions against what
  remains — verify with a test asserting the composed prompt string in the
  health-on state (spec: "Instructions for a food recommendation").
- [x] 8.2 Verify with a second test that the health-off prompt does **not**
  carry the rule (spec: "Instructions with health off say nothing about
  food") — a model told to call tools it does not have reports an unknown-tool
  error to the caller as a product failure.
- [x] 8.3 Name both tests after what they guard — the prompt is an instruction
  the assistant carries, not a filter the server applies — so a green prompt
  test is never later read as an enforced guarantee.

## 9. Verification

- [x] 9.1 Run `npm test` and `npm run typecheck` — both clean.
- [x] 9.2 Mutation-verify every guard, one at a time, restoring the file after
  each and confirming the specific test that should fail is the one that
  fails: delete each of the three per-case refusals; drop each new tool from
  the open list and add each to the closed list's expected names; remove each
  of the three clamps; remove the `unclassified` filter and the nameless-item
  filter; make the dedup emit two rows for one food; make `last_eaten_day` the
  earliest; add `id`, `ownerUserId` and `carbG` back into the projection in
  each of the three tools; delete the recommendation sentence from the
  health-on prompt. Every one must go red.
- [x] 9.3 Run `openspec validate assistant-food-recommendation --strict` —
  passes.
