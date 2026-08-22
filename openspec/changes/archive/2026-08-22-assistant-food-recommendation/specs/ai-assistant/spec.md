## ADDED Requirements

### Requirement: Food candidates for a recommendation come from the caller's own records

When the caller has opted in to health, the assistant SHALL be able to reach
three sources of candidate foods, each under the caller's own identity: the
foods the caller has marked as favourites, the foods the caller has actually
eaten in a recent window, and a name search over the food dictionary visible
to the caller (the shared catalogue plus the caller's own custom items).

The ordering matters and is why there are three rather than one. A
recommendation drawn from what the caller already favourites or already eats
is a recommendation they can act on today; a dictionary search is the fallback
for when those do not cover the gap. A model with only the search would answer
every question by inventing a query, and a model with no dictionary at all
would invent the food itself along with its portion values.

Recently-eaten foods SHALL be derived from the caller's own logged meals over
a bounded window, deduplicated by food name, and SHALL carry how many times
the food was eaten in the window and the most recent day it was eaten — a food
eaten eleven times last week is a different suggestion from one eaten once a
month ago, and the model cannot tell them apart from a bare list of names.

None of these SHALL be reachable without the health opt-in, and a call naming
one while health is off SHALL be answered as an unknown tool, exactly as any
other unrecognised name is. What the caller eats and what they favourite are
diet records; they are covered by the same consent as the rest.

#### Scenario: Favourites as candidates

- **WHEN** the caller has opted in and the model asks for their favourite
  foods
- **THEN** it receives the caller's own favourited dictionary items, and no
  other user's

#### Scenario: Recently eaten foods

- **WHEN** the caller has opted in and the model asks what they have eaten
  recently
- **THEN** it receives the distinct foods from the caller's own logged meals
  in the window, each with how many times it was eaten and the most recent day

#### Scenario: The same food eaten on several days

- **WHEN** a food appears in more than one of the caller's meals in the window
- **THEN** it appears once in the answer, with the count of its appearances
  and the latest of those days

#### Scenario: Searching the dictionary

- **WHEN** the caller has opted in and the model searches for a food by name
- **THEN** it receives matching shared items and the caller's own custom
  items, and no other user's custom items

#### Scenario: A food tool named while health is off

- **WHEN** health is not opted in and the model calls one of the food tools by
  name
- **THEN** the call is answered as an unknown tool, no dictionary or meal
  record is read, and the answer is byte-identical to the one an unrecognised
  name gets

#### Scenario: No food tool writes

- **WHEN** the caller asks the assistant to log the suggested food, favourite
  it, or add it to the dictionary
- **THEN** nothing is written and no proposal is produced, because these tools
  offer no write of any kind

### Requirement: A food candidate carries only what a recommendation needs

The food records the assistant receives SHALL be a projection carrying the
food's name, its per-unit food-group portions, its calories, and its measure
basis — and SHALL NOT carry the record's identifier, its macronutrient
breakdown, its ownership, or its timestamps.

The per-unit portions are what makes the answer checkable: a suggestion is
only useful if the model can sum the portions it is proposing and set that
total against what remains. Everything else in a dictionary record is a field
that would be sent to a provider that may train on what it receives, in
exchange for nothing the recommendation uses. The measure basis is kept
because "one bowl" and "100 g" are the units the caller thinks in, and a
portion figure with no unit attached is a number the caller cannot act on.

A projection SHALL be applied identically by all three sources, so that the
model sees one shape of food regardless of where the candidate came from.

#### Scenario: Fields a candidate carries

- **WHEN** the model receives a food candidate from any of the three sources
- **THEN** it carries the name, the per-unit staple, meat, fruit and vegetable
  portions, the calories, and the measure basis

#### Scenario: Fields a candidate does not carry

- **WHEN** the model receives a food candidate
- **THEN** no identifier, macronutrient breakdown, owner or timestamp is
  included, whether or not the model asked for one

## MODIFIED Requirements

### Requirement: Unbounded health reads are clamped by the server

Every health read whose size the model could influence SHALL be bounded by the
server, and the bound SHALL be the server's, not the model's.

Four reads are unbounded as they stand. A vitals range covers whatever span is
asked for, so one sentence could ship a year of weight and blood-pressure
readings. The menstrual overview takes no range parameter at all and returns
every cycle on record, so one call ships an entire history. A recently-eaten
foods listing is bounded by nothing but how far back the model asks to look
and how many distinct foods come out of it — a wide enough window ships the
caller's whole eating history. A dictionary search matching a common
substring returns every matching row in the catalogue. All SHALL be clamped at
the tool boundary.

A request that exceeds a bound SHALL be answered with the bounded result
rather than refused: the model gets an answer it can use, and the caller gets
an answer instead of an error.

#### Scenario: A vitals range wider than the server allows

- **WHEN** the model asks for a vitals range longer than the maximum span
- **THEN** it receives at most the maximum span, not the span it asked for

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

With health off, the instructions SHALL say health, diet, care and reminder
records cannot be seen. With health on, they SHALL say health and diet records
can be seen while care and reminder records still cannot, and the rule that
sends unrelated questions out of scope SHALL widen to match — leaving it
naming finance alone would tell the model to decline the very health questions
it was just given tools for.

With health on, the instructions SHALL additionally carry the rule for a
food recommendation: read the day's remaining portions before suggesting
anything, prefer candidates the caller already favourites or has recently
eaten, fall back to a dictionary search only when those do not cover the gap,
and present the suggestion as each food group's summed portions set against
what remains. Without that rule the model answers a "what can I still eat"
question from its own training data, which is the failure this change exists
to prevent; with it, the caller can check the arithmetic in the answer.

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
- **THEN** the model is told it can see health and diet records and cannot see
  care or reminder records, and the out-of-scope rule names the records it can
  now see

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
