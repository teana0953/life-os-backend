## Context

See proposal.md — Why. The current state this design builds on:

- `ToolContext.health` (`src/contexts/assistant/application/tools.ts`) is a
  single optional field holding eight repository ports. Its presence *is* the
  health opt-in: with the header absent the route builds no `health` object,
  so there is nothing in the context to read a health record with.
- `HEALTH_TOOLS` is a plain array; `assistantTools(context)` returns
  `[...FINANCE_TOOLS, ...HEALTH_TOOLS]` when `context.health` is present.
  `runTool` is one `switch`; every health case begins with
  `if (!context.health) return unknownTool(name);` — per case, deliberately,
  so a tenth health tool cannot be added unguarded.
- Server bounds are named constants next to `TRANSACTION_LIST_MAX`, each with
  a comment saying the bound is the server's and not the model's, and each
  clamping rather than refusing.
- `getDailyTargetWithRemaining` already returns `remaining` per food group;
  the missing half is candidate foods, not arithmetic.
- `FoodDictionaryRepository` already has `search(userId, query)` (shared ∪ the
  caller's own custom items, case-insensitive substring) and
  `listFavorites(userId)`, each wrapped by a one-line use case
  (`searchFoodDictionary`, `listFavoriteFoodItems`). Visibility is enforced
  inside the repository, not restated here.
- `MealRepository.listMealsInRange(userId, from, to)` already exists and is
  already used by `getHealthCalendar` and the chaodays import. Each
  `MealItem` carries the food's **per-unit** `staple/meat/fruit/veg` and
  `kcal`, its `baseAmount`/`measureUnit`, its `quantity`, an `unclassified`
  flag, and a `name` — copied from the dictionary item at log time for
  dictionary-sourced items (`create-meal.ts:66`), caller-supplied and
  nullable for manual and AI items.
- `src/adapters/http/app.ts` already holds `options.foodDictionaryRepository`
  and already passes it to four other handlers, so wiring it into the
  assistant handler passes an option that exists at that call site.

Constraint that shapes everything below, unchanged from the health read
change: under BYOK the model runs at the provider and the server never sees
its output. Only what the server refuses to *fetch*, and how much of each row
it hands over, is enforceable.

## Goals / Non-Goals

**Goals**

- Reuse the ports and use cases that exist. No new repository method, no new
  SQL, no new endpoint, no schema change.
- The three new tools are indistinguishable from the existing nine in how
  they are gated: same single `health` field, same per-case refusal, same
  refusal string.
- Every row the model receives is a deliberate projection, and the fields left
  out are left out by construction rather than by the model not asking.
- Every bound the model could influence is a named server constant with a
  test that goes red when it is removed.

**Non-Goals**

- No write of any kind, and no new `Proposal` kind. The proposal mechanism
  stays finance-only in this change.
- No ranking or scoring of foods against the remaining portions on the server.
  The server hands over candidates and their per-unit portions; choosing a
  combination is the model's job, and doing it here would be an unverifiable
  recommendation engine nobody asked for.
- No new opt-in surface. These are diet records under the existing health
  opt-in.
- No change to `MAX_TOOL_ROUNDS`.

## Decisions

### `foodDictionary` joins the other eight ports in `HealthPorts`

Alternative: a second optional field on `ToolContext`, or passing the
repository to `runTool` separately.

Both reintroduce exactly the impossible state `HealthPorts` was created to
remove: a dictionary port present while health is off is one forgotten check
away from telling a provider which foods this caller favourites — which is a
diet record about the caller, not a public catalogue. Presence of the one
`health` field stays the single expression of consent.

The route builds it inside the same `resolveHealthOptIn(c) ? { ... }` object
literal; no new header, no new resolver.

### `list_recent_foods` aggregates in the application layer

Alternative: a `listRecentFoodNames`-style repository method with a `GROUP BY`.

Rejected. The aggregation is a fold over rows already fetched by a method that
exists, so a new method would add a SQL surface, an adapter implementation, a
fake in every test that constructs a `MealRepository`, and a second place
where "what counts as a recently eaten food" is decided. The window is at most
a month of one user's meals — the same read `getHealthCalendar` already does
for the calendar screen — so this is one database round trip either way.

The fold:

1. `listMealsInRange(userId, from, context.today)` where `from` is
   `today - (days - 1)`, inclusive, using the existing `addDays` helper.
2. Flatten to items; **drop items with no usable name** (manual and AI items
   may carry `name: null`) — a candidate the model cannot name is not a
   candidate — and **drop `unclassified` items**, which carry zero portions by
   design (D1 in diet-tracking) and would otherwise be offered as foods that
   fill nothing.
3. Group by the trimmed, lowercased name; keep the name as most recently
   spelled for display.
4. Per group: `times_eaten` = number of items in the group, `last_eaten_day`
   = the latest `day` among them, and the per-unit portion/kcal/measure values
   taken **from the most recent occurrence** — not averaged. Per-unit values
   are a snapshot taken at log time and may differ between two days; an
   average would produce a food whose values never existed, while the latest
   is the shape the caller most recently ate.
5. Sort by `times_eaten` descending, then `last_eaten_day` descending, then
   name ascending — the last key only to make the order total, so the clamp
   below cuts deterministically and its test cannot flake.

Note `quantity` is deliberately **not** summed into the answer. The question
this tool serves is "which foods are candidates", and per-unit values are what
the model needs to build a combination; how much of it the caller ate on some
past Tuesday is a different question, answerable by `list_meals`.

### Three bounds, all server-side, all clamping rather than refusing

Named beside `TRANSACTION_LIST_MAX`, following its comment convention:

- `RECENT_FOOD_DAYS_MAX = 30`, also the default when the model names no
  window. A month is long enough that a weekly favourite appears several
  times and short enough that a food dropped two months ago does not come
  back as a suggestion. A `days` argument outside `1..30` is clamped into it.
- `RECENT_FOOD_MAX = 30` distinct foods, taken from the head of the sort
  above, so the clamp keeps the *most relevant* candidates rather than
  whichever rows the database returned first.
- `FOOD_SEARCH_MAX = 20` rows. A one-character substring matches a large part
  of the seeded catalogue; the model asked for candidates, not for the
  catalogue.

`list_favorite_foods` is deliberately **not** clamped. Its size is chosen by
the caller, not by the model — the spec's rule is about reads the model can
widen — and silently dropping the caller's own favourite would make the
assistant's answer wrong in a way neither the caller nor the model can see.
Each row is small after the projection.

Each bound is stated in the tool's own description so a clamped answer is not
presented to the caller as a complete one, matching `get_vitals_range` and
`get_menstrual_overview`.

### One projection, applied by all three tools

```
{ name, staple, meat, fruit, veg, kcal, base_amount, measure_unit }
```

plus `times_eaten` and `last_eaten_day` for recent foods only.

`FoodItem` also carries `id`, `ownerUserId`, `carbG`/`proteinG`/`fatG`/
`sugarG`/`fiberG` and `createdAt`, and `MealItem` carries more still. None of
it is used to fill a remaining-portion gap, and every field kept is a field
sent to a provider that may train on it. `ownerUserId` in particular would
tell the model which of the caller's foods are private custom items — a fact
about the caller that a recommendation has no use for.

Omitting `id` has a real consequence and it is intended: **the model cannot
name a dictionary item by id in a follow-up**, which is precisely what a
logging tool would need. Since this change ships no write, the id would be a
field handed over for a capability that does not exist. A later change that
adds meal logging can add the id in the same change that adds the write.

Snake-case keys match the existing tool results (`list_transactions` returns
`category_id`).

### The recommendation rule is a prompt sentence in the health-on branch only

`systemPrompt` already branches on `context.health`; the rule joins that
branch. It has to be in the branch rather than unconditional: the health-off
prompt would otherwise instruct the model to call three tools it does not
have, which is how a model ends up asserting an unknown-tool error to the
caller as a product failure.

The sentence names the order — `get_diet_targets` for `remaining` first, then
favourites and recent foods, then `search_foods` only if those fall short —
and requires the answer to show each food group's summed portions against what
remains. That last part is the only thing that makes the recommendation
checkable by the caller; without it the model can produce a plausible list
whose portions do not add up.

Tests assert the composed prompt string, and their names say that the prompt
is an instruction and not an enforced filter — the same discipline the health
read change established, so a green prompt test is never later read as a
guarantee about what the model says.

### Mutation checks that must be run before this is called done

Each must produce a red test, one at a time, restoring the file after each:

1. Delete the per-case `if (!context.health)` refusal in each of the three new
   cases.
2. Drop each new tool from the open list, and add each to the closed list's
   expected names.
3. Remove each of the three clamps (window, distinct-food count, search rows).
4. Remove the `unclassified` filter, and remove the nameless-item filter, in
   the recent-foods fold.
5. Change the dedup so the same food yields two rows; change
   `last_eaten_day` to the earliest instead of the latest.
6. Add a withheld field (`id`, `ownerUserId`, `carbG`) back into the
   projection in each of the three tools.
7. Delete the recommendation sentence from the health-on prompt.

## Risks / Trade-offs

- **The per-unit values on a recent food are a log-time snapshot and may be
  stale relative to the dictionary.** → Accepted, and it is the right stale
  value: it is what the caller ate. `search_foods` returns current dictionary
  values for anyone who wants those.
- **Dedup by name merges two genuinely different foods that share a name**
  (a shared "白飯" and a custom "白飯" with different portions). → Accepted;
  the most recent occurrence's values win, which is the one the caller last
  actually ate. Deduping by `foodItemId` instead would split one food into two
  rows whenever it was sometimes logged manually, which is the more common and
  more confusing case.
- **Three more tools widen the model's choice and a recommendation naturally
  costs two rounds** (targets, then candidates). → Fits inside the unchanged
  `MAX_TOOL_ROUNDS = 4`, and parallel calls in one round mean favourites and
  recent foods cost one round together.
- **The prompt is the only lever over how the answer is presented.** → Written
  into the spec, as before. The enforceable half is what is fetched and which
  fields are handed over.
- **Withholding the id blocks a future "log this for me" flow.** → Deliberate;
  see the projection decision. Adding the id belongs to the change that adds
  the write.

## Migration Plan

No data migration, no schema change, no new endpoint. Deploying the backend
alone changes nothing for a caller who has not opted in to health, and for one
who has, it only adds three tools the model may choose to call. No frontend
change is required. Rollback is a redeploy — there is no state to unwind.
