## MODIFIED Requirements

### Requirement: Only finance and split records are sent to the model

The assistant SHALL reach health and diet records only when the request
carries an explicit opt-in from the caller, and SHALL have no tool reaching
care or reminder records at all.

A free provider tier generally reserves the right to use submitted content to
improve its products, and this product holds menstrual, glucose and care
records. Sending those anyway is therefore not a default the product may
choose on the caller's behalf: it is a decision the caller makes, sees, and
can take back. The opt-in SHALL travel with the request rather than being
stored by the server, so that consent lives exactly where the caller granted
it — the same device that holds their model key — and SHALL be absent by
default, so a caller who never chose gets today's behaviour.

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

- **WHEN** the caller asks about care items or reminders, opted in or not
- **THEN** the assistant says it cannot see those, because no tool reaches
  them in either state

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

## ADDED Requirements

### Requirement: Health reads are per-record-type and read-only

Each health tool the assistant is given SHALL wrap exactly one existing health
use case, run under the caller's own identity, and change nothing.

The granularity is the point. A single coarse "today's health" tool would
answer "did I drink enough water" by sending blood pressure and menstrual
history to the provider along with the water. One tool per record type lets
the model fetch only the cell it actually needs, and matches the shape the
finance tools already have.

A tool that takes a day SHALL default to the caller's own current date when
the model omits it, so a missing argument reads as "today" rather than
failing or guessing a date from the conversation.

#### Scenario: One question fetches one record type

- **WHEN** the caller asks only about water
- **THEN** only the water record for that day is sent to the provider; no
  vitals, meals or menstrual record is fetched

#### Scenario: A day the model did not name

- **WHEN** the model calls a day-scoped health tool without a day
- **THEN** the caller's own current date is used

#### Scenario: No health tool writes

- **WHEN** the caller asks the assistant to record a meal, a weight or a water
  intake
- **THEN** nothing is written and no proposal is produced, because this change
  offers no health write of any kind

### Requirement: Unbounded health reads are clamped by the server

Every health read whose size the model could influence SHALL be bounded by the
server, and the bound SHALL be the server's, not the model's.

Two reads are unbounded as they stand. A vitals range covers whatever span is
asked for, so one sentence could ship a year of weight and blood-pressure
readings. The menstrual overview takes no range parameter at all and returns
every cycle on record, so one call ships an entire history. Both SHALL be
clamped at the tool boundary.

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

### Requirement: The refusal holds where tools run, not only where they are listed

When health is not opted in, a call naming a health tool SHALL be answered as
an unknown tool, exactly as any other unrecognised name is.

The advertised tool list and what the server is willing to execute are two
separate surfaces. Omitting health from the list only tells the model those
tools are not there; a model that names one anyway — from an earlier turn in
the conversation, or from text somebody else wrote — must still be refused by
the code that runs tools. Guarding only the list draws the boundary on the
side the user can see.

#### Scenario: A health tool named while health is off

- **WHEN** health is not opted in and the model calls a health tool by name
- **THEN** the call is answered as an unknown tool and no health record is
  read

#### Scenario: The list matches what will run

- **WHEN** health is not opted in
- **THEN** no health tool appears in the list the model is given

### Requirement: The assistant's stated bounds match its actual bounds

The instructions given to the model SHALL state what the assistant can and
cannot see, and SHALL state it differently in each of the two states.

With health off, the instructions SHALL say health, diet, care and reminder
records cannot be seen. With health on, they SHALL say health and diet records
can be seen while care and reminder records still cannot, and the rule that
sends unrelated questions out of scope SHALL widen to match — leaving it
naming finance alone would tell the model to decline the very health questions
it was just given tools for.

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
