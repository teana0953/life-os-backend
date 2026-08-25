## Context

See proposal.md — Why.

The shape this change has to fit is already set by the two assistant changes
that shipped before it:

- `ToolContext` (`src/contexts/assistant/application/tools.ts`) carries the
  caller's `userId`, their local `today`, the finance/split ports, and one
  optional `health` field. That field is optional *and* holds the ports on
  purpose: the opt-in and what it unlocks are one field so that "enabled with
  no repositories" and "disabled with repositories" are not expressible.
- `runTool` guards the opt-in **per case**, not with one name-list check, so a
  tool added later cannot be left unguarded by a forgotten list entry. The
  refusal is byte-identical to the unknown-name answer.
- Every read the model can widen is clamped at the tool boundary
  (`TRANSACTION_LIST_MAX`, `VITALS_RANGE_MAX_DAYS`, `MENSTRUAL_CYCLE_MAX`,
  `RECENT_FOOD_DAYS_MAX`, `RECENT_FOOD_MAX`, `FOOD_SEARCH_MAX`).
- The opt-in header `X-Assistant-Health: on` is resolved in exactly one place
  (`resolveHealthOptIn` in `assistant-key.ts`) and is listed in the CORS
  `allowHeaders` in `app.ts`.

The three care use cases already exist and are already the ones the care
screens call: `getCareToday(deps, userId, now)`,
`getCareRange(deps, userId, from, to, now)` and
`listCareItems(repository, userId, category?)`. The first two take
`{ userRepo, careItemRepo, careLogRepo }` and resolve the caller's local date
from their stored timezone themselves.

## Goals / Non-Goals

**Goals:**

- Three care reads reachable under the existing opt-in, each a thin wrapper
  over the use case the care screens already call.
- The care range bounded by the server, with the bound tied to the vitals
  range's rather than being a second independent number.
- Care records reach the provider as a projection with no identifiers in it.
- Both prompt branches state the new boundary, and the boundary they state is
  the one `assistantTools`/`runTool` actually enforce.

**Non-Goals:**

- A care write of any kind, including a proposal (see spec: "No care tool
  writes").
- A separate care opt-in, a stored consent, or any new header.
- Any change to `/api/care/*` or to the care use cases themselves — this
  change adds a fourth caller to them and nothing else.
- Reminder/push-record tools.

## Decisions

### D1: Care ports go inside the existing `health` field, not beside it

`ToolContext.health` gains `careItems`, `careLogs` and `users`. There is no
new `care?: CarePorts` field and no `careEnabled` boolean.

*Why:* one header gates both, so two optional fields would make two impossible
states expressible — care without health and health without care — with
nothing in the type stopping either. The field name stays `health` because the
header is `X-Assistant-Health` and the product already files care under
health (`/api/health/overview` serves `care_today` and `care_range` as its own
sections). Renaming the field and the `HealthPorts` interface to something
neutral was considered and rejected: it would touch `assistant.ts`, `app.ts`
and every assistant test for a rename that makes the field's name agree with
the interface's while disagreeing with the header's.

*Alternative rejected:* a second header (`X-Assistant-Care`). It asks the
caller to consent twice to one thing, needs its own CORS entry and its own
frontend toggle, and buys separability nobody asked for.

### D2: The user repository is a care port, not a reuse of `context.today`

`getCareToday`/`getCareRange` take `now: Date` and resolve the caller's local
date from `user.timezone` inside the use case. The tools pass `new Date()` and
a `UserRepository`, accepting that the caller's row is read again even though
the route already read it to compute `context.today`.

*Why:* the alternative is to bypass the use cases' contract and hand them a
date derived from `context.today`, which is a second definition of "the
caller's today" living in the assistant. One extra primary-key read per care
tool call is a much smaller price than two places that decide what day it is
for the same user.

The port is typed as the full `UserRepository` to match what the use case
deps ask for; nothing in the assistant calls anything but `getById`.

### D3: `CARE_RANGE_MAX_DAYS = VITALS_RANGE_MAX_DAYS`, defined as that expression

One number, two names, and the tie stated in code rather than in a comment
someone has to notice. Clamping follows the vitals implementation exactly: `to`
defaults to `context.today`, the earliest allowed `from` is `to` minus
(MAX − 1) days (the span is inclusive), and a `from` earlier than that is moved
forward — the request is answered bounded, never refused.

*Why 31 and not the endpoint's 366:* `/api/care/range` serves the app's
history screen, which renders to one person on their own device.
`get_care_range` ships to a model provider that may train on what it receives.
Same records, different destination, different bound. The tool description
names the bound so the model can tell the caller their wider question came
back narrower.

### D4: Three tools, mirroring the health granularity

`get_care_today` (no arguments), `get_care_range(from, to)` and
`list_care_items(category?)`.

`list_care_items` is not redundant with the other two. Slots are what happened;
items and their schedules are what is supposed to happen, including a schedule
that has not fired yet today, its dose text, and its stock. "What am I meant to
be taking" is not answerable from slots.

`get_care_today` deliberately takes no `day` argument: `get_care_range` covers
every other day, and a `day` on the today tool would make two tools able to
answer the same question with two different status rules (`getCareToday` never
returns `missed`; `getCareRange` does, for strictly past days).

### D5: A local projection in `tools.ts`, not the route's `careTodaySlotToJson`

`care.ts`'s serializers live in `src/adapters/http/` and the assistant's tools
live in `application/`; importing across would break the dependency rule. The
projection is a small local function, as `foodCandidate` already is, in
snake_case to match the rest of the tool payloads.

It drops `care_item_id`, `care_schedule_id` and the care item's `id` — the
model has no care write, so an identifier cannot be spent on anything, and
omitting it means a future care write cannot be quietly bolted on by having
the model name a row it saw. `done_time` is emitted as an ISO string; a `Date`
would reach the provider as whatever the JSON encoder in the model client
happens to do with it.

For `list_care_items` the projection keeps category, title, note, dose, stock
and stock alert, plus each schedule's time of day, repeat days, week interval,
start/end date, dose quantity and enabled flag — dropping the schedule id and
`careItemId`. `nagIntervalMinutes` is dropped too: it is a notification
setting, and notification records are the one thing this change keeps out of
reach.

### D6: The opt-in guard goes in each of the three cases

Following the existing health cases exactly: `if (!context.health) return
unknownTool(name);` inside each case, not one guard keyed on a list of names.
The check belongs with the case that touches the data, so a fourth care tool
added later cannot be unguarded by a forgotten list entry.

### D7: An unrecognised `category` is an answer, not a silent widening

`list_care_items` validates `category` against the four known values and
returns `{ error: ... }` naming them when it is anything else, following
`search_foods`'s empty-query answer. Silently dropping the filter would answer
a narrowed question with an un-narrowed list, and the model would present the
result as narrowed. An absent `category` is not an error — it means all
categories, as the endpoint's absent query parameter does.

### D8: Both prompt branches change, and one new sentence is added

Off: "health, diet, care or reminder records" stays as the list of what cannot
be seen (unchanged in effect). On: the visibility sentence gains care, the
out-of-scope sentence gains care, and "You cannot see care or reminder
records" becomes "You cannot see reminder or push-notification records".

The on-branch also gains one sentence: report what is recorded and scheduled,
and decline the medical judgement. Medicine is already out of scope, but a
tool that returns "血壓藥 08:00 missed" makes "should I take it now" look like
a question about the caller's own records. The sentence is an instruction the
model carries, not something the server can enforce — under BYOK the server
never sees the model's output. Tests assert the sentence is in the prompt;
that is the whole of what is verifiable here, and the spec says so.

## Risks / Trade-offs

- **Medication history reaching a provider that may train on it** → This is
  the change's whole cost, and it is paid only by a caller who turned the
  opt-in on. Mitigated by per-record-type tools (a "did I take my pills"
  question ships care slots and no vitals), the 31-day range bound, and the
  identifier-free projection.
- **The 31-day bound silently narrows "how did last quarter go"** → The bound
  is named in the tool description, as the vitals range's is, so the model can
  say the answer covers the last 31 days. Unverifiable server-side, like every
  prompt-carried rule here.
- **The model giving dosing advice off a `missed` status** → The prompt
  sentence in D8, plus the existing out-of-scope rule that already names
  medicine. Not enforceable; stated as such in the spec.
- **An extra user read per care tool call** → One primary-key lookup, on a row
  the request already loaded once. Accepted in exchange for a single
  definition of the caller's local date (D2).
- **`getCareRange` expands every schedule across every day in memory** →
  Bounded by the 31-day clamp; the endpoint already runs the same expansion
  over spans up to 366 days.
- **`getCareToday`/`getCareRange` throw when the user row is missing** →
  Unreachable here: `resolveUserId` already resolved that same row for this
  request. Left as-is rather than adding a defensive branch for an impossible
  state.

## Migration Plan

No database change, no new endpoint, no new header, no stored state. Deploy is
the backend alone; the app already sends `X-Assistant-Health: on` for callers
who opted in, so care becomes readable for them on deploy with no client
release. Rollback is reverting the commit — nothing to undo, since the change
writes nothing and stores nothing.

## Open Questions

- The opt-in toggle's copy in `life-os` says the switch covers health and diet
  records; after this ships it also covers care. Updating that copy is a
  frontend change tracked separately under issue #233 and does not block this
  one — the consent's scope is described in the app, not enforced by it.
