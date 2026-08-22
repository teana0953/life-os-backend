## Why

The assistant can already tell an opted-in caller how many portions they have
left today — `get_diet_targets` returns `remaining` per food group — but it
cannot name a single food that would fill them. It has no tool that reaches
the food dictionary and no tool that looks past the current day's meals, so
"我還能吃什麼" ends in an apology or, worse, in the model inventing a food and
a portion figure from its own training data. This product holds a dictionary
of foods with real per-unit portion values, and the caller's own favourites
and eating history are the best possible candidate list; the gap is only that
none of it is reachable from the assistant.

## What Changes

- `HealthPorts` gains the food dictionary port, so the assistant's health
  bundle can reach the dictionary the diet screens already use.
- Three new read-only tools, registered **only** when the caller opted in to
  health on this request, exactly like the nine existing health tools:
  - `list_favorite_foods` — the caller's favourited dictionary items
    (`listFavoriteFoodItems`).
  - `list_recent_foods` — foods the caller has actually eaten recently,
    aggregated in the application layer from `listMealsInRange` over a
    server-bounded window: deduplicated by name, each carrying how many times
    it was eaten and the most recent day. No new repository method and no new
    SQL.
  - `search_foods` — name-substring search over shared items ∪ the caller's
    own custom items (`searchFoodDictionary`), row count bounded by the
    server.
- All three return a **projection**, not a `FoodItem`: name, per-unit
  `staple`/`meat`/`fruit`/`veg`, `kcal`, and the measure basis
  (`base_amount`/`measure_unit`). Ids, macro breakdowns, ownership and
  timestamps are not what a recommendation needs, and each field withheld is a
  field not sent to a provider that may train on it.
- Each new bound is a named constant beside `TRANSACTION_LIST_MAX`, with the
  same "the bound is the server's, not the model's" rule: how many days back
  `list_recent_foods` looks (30), how many distinct foods it returns, and how
  many rows `search_foods` returns. An over-wide ask is clamped, not refused.
- The health-on branch of the system prompt gains a recommendation rule: when
  asked what is left to eat, call `get_diet_targets` first for `remaining`,
  draw candidates from favourites and recent foods, reach for `search_foods`
  only when those are not enough, and present the suggestion as each food
  group's summed portions against what remains.

Not in this change: any write — no meal logging, no food-item creation, no
favouriting, and no proposal of any kind (the proposal mechanism stays
finance-only). No new endpoint, no new repository method, no SQL, no database
change, no change to the opt-in header or to what an opted-out caller sees.

## Capabilities

### New Capabilities
<!-- none: this extends the existing assistant capability -->

### Modified Capabilities

- `ai-assistant`: adds requirements for reading the food dictionary and the
  caller's eating history under the existing health opt-in; extends
  "Unbounded health reads are clamped by the server" to the three new reads;
  extends "The assistant's stated bounds match its actual bounds" with the
  recommendation rule the health-on instructions must carry.

## Impact

- `src/contexts/assistant/application/tools.ts` — `HealthPorts` gains
  `foodDictionary`; three tool definitions in `HEALTH_TOOLS`; three `runTool`
  cases, each carrying the same per-case opt-in refusal the existing health
  cases carry; three bound constants; the field projection.
- `src/contexts/assistant/application/converse.ts` — the health-on branch of
  `systemPrompt` gains the recommendation rule.
- `src/adapters/http/routes/assistant.ts` — `AssistantHandlerOptions` gains
  `foodDictionaryRepository`; it is put into `context.health` in the same
  place the other eight ports are built.
- `src/adapters/http/app.ts` — passes the already-present
  `options.foodDictionaryRepository` into `createAssistantHandler`.
- Tests under `test/contexts/assistant/` (`healthPorts` helper gains the port;
  both whole-list assertions grow by three names) and
  `test/adapters/http/assistant.test.ts`.
- No CORS change: the opt-in header already exists and is already allowed.
- Frontend: none required. These are model-facing tools; the existing health
  opt-in toggle already gates them.
