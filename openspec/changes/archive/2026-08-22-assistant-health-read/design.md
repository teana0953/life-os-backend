## Context

See proposal.md — Why. The relevant current state:

- `ToolContext` (`tools.ts`) carries `userId`, `today`, `defaultMonth` and four
  finance/split repository ports. `ASSISTANT_TOOLS` is an exported constant
  array; `runTool` is a `switch` over tool names with a `default` returning
  `{ error: "unknown tool: ..." }`.
- `converse.ts` builds one system prompt string per request and passes
  `ASSISTANT_TOOLS` to every model turn. `MAX_TOOL_ROUNDS = 4`, and a round may
  contain parallel calls (`ToolRound { calls, results }`).
- The route (`routes/assistant.ts`) already resolves the caller's timezone and
  `today`, and `resolveModelApiKey` already reads `X-Gemini-Api-Key` from a
  header in one place.
- `createApp` already holds every health repository, so wiring them into the
  assistant handler is passing options that already exist at that call site.
- The nine target use cases have plain function signatures taking their ports
  plus `userId` (and a day, a range, or nothing).

Constraint that shapes everything below: the server never sees the model's
output. Under BYOK the model runs at the provider, so anything expressed as
"the assistant will not say X" is unenforceable; only what the server refuses
to *fetch* is enforceable.

## Goals / Non-Goals

**Goals**

- Off by default, and off means the server will not read a health record even
  if asked by name.
- The opt-in state and the health repositories cannot disagree with each other.
- Both prompt branches, and both sides of the refusal (list and execution), are
  covered by tests that go red when the behaviour is removed.

**Non-Goals**

- No server-side persistence of consent, no new table, no new endpoint.
- No change to `MAX_TOOL_ROUNDS`. Parallel calls in one round mean "how am I
  doing today" resolves within the existing cap; raising it is a separate
  question about cost, not about this feature.
- No attempt to detect a paid provider tier.

## Decisions

### The opt-in rides on a request header, `X-Assistant-Health`

Alternatives: a body field, or a stored per-user setting.

A body field would put consent inside a payload the route already parses
loosely and would mix the caller's data with the caller's permissions. A
stored setting would put consent on the server, which is exactly what this
design is avoiding: the key lives on one device, so the consent that says "send
my records to the provider using that key" lives on the same device. A header
also matches `X-Gemini-Api-Key`, so both live in one adapter-level place.

Reading it goes next to `resolveModelApiKey` (`routes/assistant-key.ts`), which
is already the single place that knows where the request's assistant-specific
inputs come from.

**Fail closed on anything unclear**: health is on only for an exact, agreed
value (`"on"`); an absent header, an empty value, or any other value is off. A
typo must not silently enable it.

**`app.ts` `allowHeaders` gains the header in the same commit as the header is
introduced.** Not "later, when the frontend lands": the browser preflight
rejects an unlisted header before the request leaves the client, and no
server-side test can see that. `X-Gemini-Api-Key` already cost one round of
this exact failure.

### The flag and the repositories are one field, not two

`ToolContext` gains a single optional field holding the health ports:

```
health?: {
  dailyTargets, meals, water, bowel, vitals, exercise, menstrual, bodyProfile
}
```

Alternative: a `healthEnabled: boolean` plus always-present repositories. That
makes two states representable that must never occur — enabled with no
repositories (a crash), and disabled with repositories present (one forgotten
check away from reading a record the caller did not consent to). Collapsing
them into presence/absence of one field removes both by construction: with the
flag off there is nothing in the context to read a health record *with*.

The route builds that field only when the header says on.

### `ASSISTANT_TOOLS` becomes `assistantTools(context)`

The list depends on the context, so it is derived from the context rather than
from a separate boolean the caller must remember to keep in sync. `converse`
calls it once per request and passes the result to each turn.

The existing whole-list test (`toEqual([...])`, deliberately not
`not.toContain`) is duplicated rather than edited: one assertion for the closed
list, one for the open list. Asserting only "health tools are in the open list"
would stay green if a health tool leaked into the closed list.

### `runTool` refuses by name, in the same `switch`

Health cases are added to the existing `switch`. Each begins by checking the
health field and returning the *existing* unknown-tool answer when it is
absent — the same string, not a new "not permitted" one, because a distinct
message would tell the model (and anything reading the transcript) that a tool
by that name exists and is being withheld, which is a fact about the caller.

The check must be per-case rather than a single early guard keyed on a name
list, so that adding a tenth health tool without adding it to a list cannot
silently produce an unguarded case. (A guard keyed on "names starting with
`get_`" would also catch finance tools — the guard belongs with the case that
touches health, not with a name pattern.)

### The two clamps

- `get_vitals_range`: **31 days** maximum span. Clamp by moving `from` forward
  to `to - 30 days` when the requested span is wider, rather than refusing:
  the model gets a usable answer and the caller gets an answer instead of an
  error. 31 covers "this month" and "the last four weeks", which is what the
  trends screen shows.
- `get_menstrual_overview`: **12** most-recent cycles. The use case takes no
  range parameter and returns every period on record, so the clamp lives in the
  tool: take the tail of the ascending list. 12 covers roughly a year, enough
  for the derived cycle statistics to mean something.

Both numbers are named constants next to `TRANSACTION_LIST_MAX`, with the same
"the bound is the server's, not the model's" reasoning, and both are stated in
the tool description so the model does not present a clamped answer as complete.

Note the derived statistics from `get-menstrual-overview` are computed over the
*full* history inside the use case. Clamping the returned periods does not
change the statistics, and the tool result keeps them — a summary over a year
of cycles is a far smaller disclosure than the cycles themselves.

### The prompt branches on the same context field

`systemPrompt(context)` picks between two sentence pairs based on presence of
the health field. Two sentences change together:

- the visibility sentence (`You cannot see health, diet, ...` →
  `You can see ... health and diet ...; you cannot see care or reminder
  records`)
- the out-of-scope sentence, which today names "the caller's own finance and
  split records". Left alone, it instructs the model to decline exactly the
  health questions it was just given tools for.

Tests assert on the composed prompt string in each branch. The specs say
plainly that this is all that is verifiable on this side; the test names say so
too, so nobody later reads a green prompt test as "health leakage is blocked".

### Mutation checks that must be run before this is called done

Each of these must produce a red test:

1. Invert the header check (on ↔ off).
2. Drop one health tool from the open list; drop one from the closed list's
   expected names.
3. Delete the per-case refusal in `runTool` for one health tool.
4. Delete each of the four prompt sentences (two branches × two sentences).
5. Remove either clamp.
6. Remove the header from `allowHeaders`.

## Risks / Trade-offs

- **The prompt is the only lever over what the model *says*.** → Accepted and
  written into the spec. The enforceable half is what the server fetches, and
  that half is guarded by the `runTool` refusal, not by the prompt.
- **Opt-in is per device, so a user who enables it on their phone finds it off
  on the laptop.** → Accepted; it matches the BYOK key exactly, and the
  alternative (server-stored consent) contradicts the reason the key is not
  stored either. Cross-device sync is explicitly out of scope.
- **Nine new tools widen the model's choice and could cost an extra round on
  vague questions.** → Parallel calls within one round mean the common "how is
  today going" still fits; the round cap is unchanged and already has a
  user-visible notice when hit.
- **The clamps are guesses at what is enough.** → Both are single named
  constants, changeable in one place, and clamping (rather than refusing) means
  a too-tight bound degrades the answer instead of breaking the feature.
- **A frontend that forgets to clear the toggle on sign-out leaves the next
  account's records reachable.** → Frontend-side and tracked with the frontend
  issue; called out here because the BYOK key had this exact bug once.

## Migration Plan

No data migration. Deploying the backend alone is a no-op for existing
clients: without the header nothing changes. The frontend can ship afterwards
at any time. Rollback is a redeploy — no state to unwind.
