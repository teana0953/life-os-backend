## Why

The assistant deliberately cannot see health data today, and the reason is
written into `src/contexts/assistant/application/tools.ts:22-26`: a free
provider tier generally reserves the right to train on what it is sent, and
this product holds menstrual, glucose and care records. That blanket refusal
also makes the assistant useless for the questions this product exists to
answer — "did I drink enough water today", "how has my blood pressure moved
this week".

This change overturns the refusal, but not silently. Health tools stay off by
default and are registered only when the caller explicitly opts in on that
device. Consenting to send health records to a model provider becomes a thing
the user can see, press and turn back off — the same mental model as the BYOK
key: the key lives on one device, so the consent lives on that device too.

## What Changes

- The assistant gains nine read-only health tools, each wrapping one existing
  health use case with the caller's own `userId`:
  `get_diet_targets`, `list_meals`, `get_water_day`, `get_exercise_day`,
  `get_vitals_day`, `get_vitals_range`, `get_weight_goal`, `get_bowel_day`,
  `get_menstrual_overview`. `day` defaults to the caller's today.
- Those tools are **not** registered unless the request carries an explicit
  opt-in request header. Without it the assistant behaves exactly as it does
  today.
- **BREAKING (internal API)**: `ASSISTANT_TOOLS` stops being an exported
  constant and becomes a function of the opt-in flag. Callers that imported
  the constant must call the function.
- `runTool` refuses health tool names when health is off, falling back to the
  existing `unknown tool` answer — the list the model sees and what the server
  will actually execute are two separate surfaces, and only fixing the first
  draws the guard on the side the user can see.
- Two ranges are clamped by the server, matching the existing
  "a listing the model cannot widen" rule: the day span of
  `get_vitals_range`, and the number of cycles `get_menstrual_overview`
  returns (that use case returns *every* period today, with no range
  parameter at all).
- The system prompt gains two branches. Off: today's wording, unchanged
  ("cannot see health, diet, care or reminder records"). On: rewritten to say
  health and diet are visible while care and reminder records still are not,
  with the out-of-scope sentence widened to match. Both branches carry tests
  that go red when deleted.
- `allowHeaders` in the CORS middleware (`src/adapters/http/app.ts:252`)
  gains the new header. Missing it makes the browser preflight reject every
  assistant request — the failure mode `X-Gemini-Api-Key` already caused
  once, visible only on a real device while the test suite stayed green.

Not in this change: any health **write** proposal, split write proposals,
care/reminder tools, cross-device sync of the opt-in, and paid-tier detection
(a paid Gemini tier is not trained on, but BYOK cannot tell a key's tier apart
— this change will not pretend it can).

## Capabilities

### New Capabilities
<!-- none: this extends the existing assistant capability -->

### Modified Capabilities

- `ai-assistant`: the requirement "Only finance and split records are sent to
  the model" is replaced by one that makes health reachable only behind an
  explicit per-request opt-in, adds the server-side clamps for the two
  unbounded health reads, requires the refusal to hold in `runTool` and not
  only in the advertised tool list, and requires the system prompt to state
  the correct bounds in both states.

## Impact

- `src/contexts/assistant/application/tools.ts` — `ToolContext` gains the
  health repositories and the opt-in flag; `ASSISTANT_TOOLS` becomes a
  function; `runTool` gains the health cases and the closed-state refusal.
- `src/contexts/assistant/application/converse.ts` — `systemPrompt` branches.
- `src/adapters/http/routes/assistant.ts` — reads the new header, builds the
  wider `ToolContext`.
- `src/adapters/http/app.ts` — CORS `allowHeaders`, plus passing the health
  repositories into `createAssistantHandler`.
- Tests under `test/contexts/assistant/` and `test/adapters/http/`.
- No database change, no new endpoint, no stored consent: the server keeps no
  opt-in state.
- Frontend (`life-os-app`, tracked separately) must send the header and own
  the setting toggle, clearing it on sign-out alongside the BYOK key.
