## ADDED Requirements

### Requirement: Care reads are per-record-type, read-only, and ride the health opt-in

The assistant SHALL be able to reach the caller's own care records only when
the request carries the same explicit opt-in that unlocks health and diet
records, and SHALL reach them through the same application use cases the care
screens call, under the caller's own identity.

Care rides the existing opt-in rather than one of its own. The product already
treats care as part of health — the health overview batch serves today's care
slots and the care range as sections of itself — so a second consent would ask
the caller to answer the same question twice, in two places, about records
they think of as one thing. A caller who has not opted in gets today's
behaviour: no care tool listed, and none executable.

Three reads SHALL be offered, one per record shape, following the granularity
the health tools already have: today's care slots with their derived status,
care slots over a local-date range, and the caller's care items with their
schedules (optionally narrowed to one category). The third is not redundant
with the first two: slots say what happened, items say what is supposed to
happen, and a question like "what am I meant to be taking" cannot be answered
from slots alone.

A day- or range-scoped care read SHALL default to the caller's own current
date when the model names none, so a missing argument reads as "today" rather
than failing or guessing a date from the conversation. The caller's local date
SHALL be resolved from their own timezone, as the care endpoints already do.

No care tool SHALL write, and none SHALL produce a proposal. Marking a slot
done or skipped, creating, editing or deleting a care item, and adjusting
stock are all out of reach — the assistant reads text other people wrote, and
a care write is a medication record.

Reminder and push-notification records SHALL remain unreachable in both
states.

#### Scenario: A care question after opting in

- **WHEN** the caller has opted in and asks whether they have taken today's
  medication
- **THEN** the answer comes from the same care slots the care screen shows,
  for the caller's own records

#### Scenario: A care question without the opt-in

- **WHEN** the caller has not opted in and asks about their care records
- **THEN** the assistant says it cannot see those, rather than reaching for
  them

#### Scenario: A care tool named while the opt-in is off

- **WHEN** the opt-in is absent and the model calls a care tool by name
- **THEN** the call is answered as an unknown tool, no care record is read,
  and the answer is byte-identical to the one an unrecognised name gets

#### Scenario: The list matches what will run

- **WHEN** the opt-in is absent
- **THEN** no care tool appears in the list the model is given

#### Scenario: What is scheduled, not only what happened

- **WHEN** the caller asks what they are supposed to be taking or doing
- **THEN** the assistant can read their care items and schedules, narrowed to
  one category when the question names one

#### Scenario: A day the model did not name

- **WHEN** the model calls a day- or range-scoped care tool without a date
- **THEN** the caller's own current local date is used

#### Scenario: No care tool writes

- **WHEN** the caller asks the assistant to mark a dose as taken, add a care
  item, or change a schedule
- **THEN** nothing is written and no proposal is produced, because these tools
  offer no write of any kind

#### Scenario: Reminder records stay out of reach

- **WHEN** the caller asks about their reminder or push-notification records,
  opted in or not
- **THEN** the assistant says it cannot see those, because no tool reaches
  them in either state

### Requirement: A care record the model receives carries no identifiers

The care records the assistant receives SHALL be a projection carrying what
the answer is made of — the category, title, note, dose, the slot's time of
day and local date, its status and the time it was done, and the dose quantity
— and SHALL NOT carry the care item's, schedule's or log's identifier.

Same rule as the food candidates: the model has no care write, so an
identifier cannot be spent on anything, and every field kept is a field sent
to a provider that may train on what it receives. Omitting the identifiers
also means a later care write cannot be bolted on by having the model name a
row it saw — such a write has to arrive as a deliberate change to this
specification.

The projection SHALL be applied identically to every care source, so the model
sees one shape of care record wherever the record came from.

#### Scenario: Fields a care record carries

- **WHEN** the model receives a care slot
- **THEN** it carries the category, title, note, dose, time of day, local
  date, status, done time and dose quantity

#### Scenario: Fields a care record does not carry

- **WHEN** the model receives a care slot or care item
- **THEN** no care item, schedule or log identifier is included, whether or
  not the model asked for one

## MODIFIED Requirements

### Requirement: Only finance and split records are sent to the model

The assistant SHALL reach health, diet and care records only when the request
carries an explicit opt-in from the caller, and SHALL have no tool reaching
reminder or push-notification records at all.

A free provider tier generally reserves the right to use submitted content to
improve its products, and this product holds menstrual, glucose and care
records. Sending those anyway is therefore not a default the product may
choose on the caller's behalf: it is a decision the caller makes, sees, and
can take back. The opt-in SHALL travel with the request rather than being
stored by the server, so that consent lives exactly where the caller granted
it — the same device that holds their model key — and SHALL be absent by
default, so a caller who never chose gets today's behaviour.

One opt-in SHALL cover health, diet and care together. The product already
presents care as part of health, and splitting the consent would ask the
caller the same question twice about records they think of as one thing.

The opt-in SHALL be carried in a request header, and that header SHALL be
permitted by the endpoint's cross-origin preflight configuration. A browser
rejects a request carrying an unlisted header before it leaves the client, so
an unlisted header disables the feature on the product's main client while
every server-side test still passes.

Within finance, the assistant MAY read individual transactions — "which
dinner was that" is a real question an aggregate cannot answer — but the
number of rows it can pull SHALL be bounded, and the bound SHALL be the
server's, not the model's. An unbounded listing turns one careless question
into a month of records leaving the account.

#### Scenario: A health question

- **WHEN** the caller has not opted in and asks about weight, meals or vitals
- **THEN** the assistant says it cannot see those, rather than reaching for
  them

#### Scenario: A health question after opting in

- **WHEN** the caller has opted in and asks about their water intake today
- **THEN** the answer comes from the same day's water record the health screen
  shows, for the caller's own records

#### Scenario: A care or reminder question

- **WHEN** the caller asks about care items or care slots
- **THEN** the assistant reaches them only when the request carries the same
  opt-in that unlocks health and diet, and says it cannot see them otherwise;
  reminder and push-notification records stay unreachable in either state

#### Scenario: The browser preflight allows the opt-in header

- **WHEN** a cross-origin client asks whether it may send the opt-in header
- **THEN** the endpoint's preflight response names that header among those it
  accepts

The assistant SHALL also stay off questions that are not about the caller's
records at all — general knowledge, brands, news, recipes, medicine, code,
chit-chat. It is an assistant over the caller's own records on the caller's
own key, not a general chatbot; answering "which McDonald's burger is the
classic" spends the caller's quota on something the product never promised and
invites trust in answers no tool here can check. The prompt is the only lever:
with BYOK the provider runs the model, so this is an instruction the assistant
carries, not a filter the server can enforce.

#### Scenario: A question about the world

- **WHEN** the caller asks something unrelated to the records the assistant
  can see
- **THEN** the assistant declines in one short sentence and says what it can
  help with instead, rather than answering

#### Scenario: A listing the model cannot widen

- **WHEN** the model asks for more transactions than the server allows
- **THEN** it receives the server's maximum, not the number it asked for

### Requirement: Unbounded health reads are clamped by the server

Every read the opt-in unlocks whose size the model could influence SHALL be
bounded by the server, and the bound SHALL be the server's, not the model's.

Five reads are unbounded as they stand. A vitals range covers whatever span is
asked for, so one sentence could ship a year of weight and blood-pressure
readings. The menstrual overview takes no range parameter at all and returns
every cycle on record, so one call ships an entire history. A recently-eaten
foods listing is bounded by nothing but how far back the model asks to look
and how many distinct foods come out of it — a wide enough window ships the
caller's whole eating history. A dictionary search matching a common
substring returns every matching row in the catalogue. A care range covers
whatever span is asked for and expands every schedule across it, so one
sentence could ship a year of medication history. All SHALL be clamped at the
tool boundary.

The care range's maximum SHALL be the same span as the vitals range's. The two
answer the same shape of question — "how has this gone lately" — and a reader
who has to remember two numbers will eventually pick the wrong one. This bound
is the assistant's own and is deliberately far tighter than the span the care
range endpoint serves to the app's history screen; the screen renders to one
person, the tool ships to a provider.

A request that exceeds a bound SHALL be answered with the bounded result
rather than refused: the model gets an answer it can use, and the caller gets
an answer instead of an error.

#### Scenario: A vitals range wider than the server allows

- **WHEN** the model asks for a vitals range longer than the maximum span
- **THEN** it receives at most the maximum span, not the span it asked for

#### Scenario: A care range wider than the server allows

- **WHEN** the model asks for a care range longer than the maximum span
- **THEN** it receives at most the maximum span, ending at the range's end,
  not the span it asked for

#### Scenario: A long menstrual history

- **WHEN** the caller has more recorded cycles than the maximum
- **THEN** the tool returns at most the maximum number of most-recent cycles,
  not the whole history

#### Scenario: A recent-foods window wider than the server allows

- **WHEN** the model asks to look further back than the maximum window
- **THEN** it receives foods from at most the maximum window, not the window
  it asked for

#### Scenario: More distinct recent foods than the server returns

- **WHEN** the caller ate more distinct foods in the window than the maximum
- **THEN** the tool returns at most the maximum, chosen by how relevant they
  are as candidates rather than by whatever order the records came back in

#### Scenario: A dictionary search matching many foods

- **WHEN** the model searches for a substring matching more rows than the
  maximum
- **THEN** it receives at most the maximum number of rows

### Requirement: The assistant's stated bounds match its actual bounds

The instructions given to the model SHALL state what the assistant can and
cannot see, and SHALL state it differently in each of the two states.

With the opt-in off, the instructions SHALL say health, diet, care and
reminder records cannot be seen. With it on, they SHALL say health, diet and
care records can be seen while reminder and push-notification records still
cannot, and the rule that sends unrelated questions out of scope SHALL widen
to match — leaving it naming finance alone would tell the model to decline the
very questions it was just given tools for.

With the opt-in on, the instructions SHALL additionally carry the rule for a
food recommendation: read the day's remaining portions before suggesting
anything, prefer candidates the caller already favourites or has recently
eaten, fall back to a dictionary search only when those do not cover the gap,
and present the suggestion as each food group's summed portions set against
what remains. Without that rule the model answers a "what can I still eat"
question from its own training data, which is the failure that rule exists to
prevent; with it, the caller can check the arithmetic in the answer.

The instructions SHALL NOT tell the model to give medical advice about a care
record. Reporting what is recorded and what is scheduled is in scope; deciding
whether a dose should be taken, doubled or skipped is medicine, which is
already out of scope, and a care record makes it look in scope.

This is an instruction the assistant carries, not a filter the server applies.
Under BYOK the model runs on the provider's side and the server never sees its
output, so nothing here can be enforced after the fact. Both states SHALL
therefore be covered by tests asserting the instructions are present — that is
the only thing verifiable on this side, and the specification says so plainly
so that a later reader does not mistake it for an enforced guarantee.

#### Scenario: Instructions with health off

- **WHEN** a request arrives without the opt-in
- **THEN** the model is told it cannot see health, diet, care or reminder
  records

#### Scenario: Instructions with health on

- **WHEN** a request arrives with the opt-in
- **THEN** the model is told it can see health, diet and care records and
  cannot see reminder or push-notification records, and the out-of-scope rule
  names the records it can now see, care included

#### Scenario: Instructions for a food recommendation

- **WHEN** a request arrives with the opt-in
- **THEN** the model is told to read the remaining portions first, to draw
  candidates from favourites and recently eaten foods before searching the
  dictionary, and to show the suggestion's summed portions against what
  remains

#### Scenario: Instructions with health off say nothing about food

- **WHEN** a request arrives without the opt-in
- **THEN** the recommendation rule is absent, because none of the tools it
  refers to exist in that state

#### Scenario: A question about whether to take a dose

- **WHEN** the caller asks whether they should take a dose they missed, or
  take two
- **THEN** the assistant reports what is recorded and declines the medical
  judgement, rather than advising a dose
