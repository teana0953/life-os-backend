## Why

The assistant can read finance, split, health and diet records, but care
records are refused in both opt-in states — the refusal is written into
`src/contexts/assistant/application/tools.ts` ("care and reminder records are
reachable in neither state") and into the system prompt in both branches. That
blanket refusal made sense while care was the one record type nobody had
consented to send; it stopped making sense once the health opt-in shipped,
because care is the record type this product's owner asks about most ("我今天
的藥吃了嗎", "這週有幾次沒做復健"), and the product itself already treats care
as part of health: `/api/health/overview` serves `care_today` and `care_range`
as sections of the health batch (issue #233).

## What Changes

- The assistant gains three read-only care tools, each wrapping one existing
  use case with the caller's own `userId` and changing nothing:
  - `get_care_today` → `getCareToday` — today's care slots with their derived
    status, in the caller's own timezone.
  - `get_care_range(from, to)` → `getCareRange` — per-slot care records over a
    local-date range, for "how did last week go".
  - `list_care_items(category?)` → `listCareItems` — the caller's care items
    and their schedules, so the assistant can answer what is *supposed* to
    happen rather than only what did.
- These three ride the **existing** `X-Assistant-Health: on` opt-in. No new
  header, no new setting, no stored consent. With the header absent the three
  tools are neither listed nor executable, exactly as the health tools are
  today.
- `get_care_range` is clamped server-side to a maximum span, following
  `VITALS_RANGE_MAX_DAYS`: the bound is the server's, not the model's, and an
  over-wide request is answered with the bounded result rather than refused.
- Care records the model receives are a projection: no `care_item_id`,
  `care_schedule_id` or `id`, matching the rule the food candidates already
  follow — the model has no write, so an identifier buys nothing and is one
  more field sent to a provider that may train on it.
- The `tools.ts` file-header comment's "care and reminder records are
  reachable in neither state" is rewritten; reminder/push records stay
  unreachable in both states.
- The system prompt changes in both branches: health-off now says health, diet
  and care records cannot be seen (unchanged in effect, reworded for the new
  rule); health-on says health, diet and care records can be seen while
  reminder and push records still cannot, and the out-of-scope sentence widens
  to name care.

Not in this change: any care **write** or proposal (no marking a slot done, no
creating or editing a care item), reminder/push-record tools, a separate care
opt-in header, and any change to the `/api/care/*` endpoints themselves.

## Capabilities

### New Capabilities
<!-- none: this extends the existing assistant capability -->

### Modified Capabilities

- `ai-assistant`: three requirements change.
  - "Only finance and split records are sent to the model" — its "no tool
    reaches care or reminder records at all" clause and the matching scenario
    are replaced: care rides the same opt-in as health, and only reminder/push
    records stay unreachable.
  - "Unbounded health reads are clamped by the server" — widened to cover the
    care range, whose span the model chooses.
  - "The assistant's stated bounds match its actual bounds" — both prompt
    branches must now name care on the correct side of the line.

  Two requirements are added: one making care reads per-record-type,
  read-only and gated on the health opt-in (including the refusal holding in
  `runTool`, not only in the advertised list), and one fixing what a care
  record the model receives carries.

## Impact

- `src/contexts/assistant/application/tools.ts` — `HealthPorts` gains the care
  item, care log and user ports; three tool descriptors; three `runTool` cases
  with the per-case opt-in refusal; the range clamp; the projection; the
  file-header comment.
- `src/contexts/assistant/application/converse.ts` — `systemPrompt` wording in
  both branches.
- `src/adapters/http/routes/assistant.ts` — `AssistantHandlerOptions` gains the
  care item and care log repositories; the opt-in-only context carries them
  (the user repository is already an option).
- `src/adapters/http/app.ts` — passes the two care repositories into
  `createAssistantHandler`.
- Tests under `test/contexts/assistant/` and `test/adapters/http/`.
- No database change, no new endpoint, no new header, no stored consent.
- No frontend change is required: the app already sends
  `X-Assistant-Health: on` when the caller has opted in. The setting's copy in
  `life-os` may want to say the opt-in now covers care records too — tracked
  separately, not blocking this change.
