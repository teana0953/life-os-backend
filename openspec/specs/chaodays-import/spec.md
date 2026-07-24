# chaodays-import Specification

## Purpose
TBD - created by archiving change import-chaodays-weight. Update Purpose after archive.
## Requirements
### Requirement: Import chaodays weight and body fat into vitals

An authenticated lifeos user SHALL be able to import their chaodays weight and
body-fat records for a date range into their lifeos vitals, by supplying their
chaodays credentials. Each imported day SHALL set only the day's weight and body
fat, preserving any existing blood-pressure, glucose, and blood-oxygen readings on
that day. The response SHALL summarize how many days were imported and skipped.

#### Scenario: Weight and body fat are imported for the range
- **WHEN** the user POSTs valid chaodays credentials and a `start_date`/`end_date` range
- **THEN** each chaodays weight record in range is written to that day's vitals (weight + body fat), and the response reports the imported and skipped counts and the range

#### Scenario: Import preserves other vitals on the same day
- **WHEN** a day being imported already has blood-pressure or glucose readings in lifeos
- **THEN** the import updates only that day's weight and body fat and leaves the existing readings intact

#### Scenario: A record without a weight is skipped
- **WHEN** a chaodays weight record in range has no weight value
- **THEN** that day is counted as skipped and not written

#### Scenario: A missing body fat does not erase an existing one
- **WHEN** a chaodays weight record has a weight but no body-fat value, and that day already has a body-fat value in lifeos
- **THEN** the import updates the weight and leaves the existing body fat intact

### Requirement: chaodays credentials are used transiently, never stored

The chaodays password and the resulting session token SHALL be used only within
the request to authenticate to chaodays and pull data, and SHALL NOT be persisted
to the database, logs, or environment.

#### Scenario: Credentials are not persisted
- **WHEN** an import completes (successfully or with an error)
- **THEN** no chaodays password or session token is written to storage or logs

### Requirement: Upstream and validation failures map to distinct responses

Invalid input SHALL return 400; wrong chaodays credentials SHALL return 400
`chaodays_auth_failed`; a chaodays upstream failure (non-auth) SHALL return 502
`chaodays_unavailable` rather than a lifeos-internal 500.

#### Scenario: Missing or malformed input is rejected
- **WHEN** the request omits `chaodays_uid`/`chaodays_password`, or `start_date`/`end_date` is not a valid `YYYY-MM-DD` with start ≤ end
- **THEN** the API returns 400

#### Scenario: Wrong chaodays credentials
- **WHEN** chaodays rejects the sign-in
- **THEN** the API returns 400 `chaodays_auth_failed`

#### Scenario: chaodays upstream is unavailable
- **WHEN** chaodays returns a non-auth error or is unreachable
- **THEN** the API returns 502 `chaodays_unavailable`

### Requirement: Import chaodays diet records into meals

An authenticated lifeos user SHALL be able to import their chaodays diet records for
a date range into lifeos meals. Each chaodays record maps to a meal by day and meal
type (breakfast/lunch/dinner/extra → 早餐/午餐/晚餐/點心); its food items are imported
with their staple/meat/fruit/veg portions (oil and sugar are dropped). Import SHALL be
idempotent per (day, meal), judged against the meals that existed **before** this
import: a day+meal that already existed is skipped and left unchanged, while multiple
chaodays records of the same type on the same day (e.g. several 點心) merge into one
meal for that day. Only items with a portion (staple/meat/fruit/veg > 0) become meal
items; oil and sugar are dropped.

#### Scenario: Food items are imported as a meal with portions
- **WHEN** the user imports a range containing a chaodays lunch with food items
- **THEN** a 午餐 meal is created for that day with those items' staple/meat/fruit/veg portions, and oil/sugar are not carried

#### Scenario: Multiple same-type records on a day merge into one meal
- **WHEN** a day has several chaodays extra (點心) records, none pre-existing in lifeos
- **THEN** all their food items are imported into a single 點心 meal for that day (not skipped as duplicates)

#### Scenario: A pre-existing meal is skipped
- **WHEN** a day already had a meal of that meal type in lifeos before the import
- **THEN** that meal type is not imported (counted as skipped once), leaving the existing meal unchanged

#### Scenario: An item with no portion does not become a meal item
- **WHEN** a diet item has no staple/meat/fruit/veg portion (e.g. a glucose-only note or a portionless text)
- **THEN** no meal item is created for it (its glucose, if any, is still extracted)

### Requirement: Extract blood glucose from diet item names into vitals

Blood-glucose values typed into a chaodays diet item's name SHALL be parsed and
appended to that day's vitals glucose readings: `前血糖` as pre-meal, `後血糖` (with an
optional hour marker) as post-meal, `空腹` as fasting, using the record's time. The
food part of the name (with the glucose text removed) is used for the meal item; an
item that is only a glucose note (no food, no portions) does not become a meal item.
Appended readings SHALL be de-duplicated against existing ones so re-import does not
duplicate them, and other vitals fields on the day are preserved.

#### Scenario: Pre/post-meal glucose is extracted
- **WHEN** an item name contains `前血糖：93` and `後血糖(1hr)：70`
- **THEN** that day's vitals gains a pre-meal reading of 93 and a post-meal reading of 70 at the record's time

#### Scenario: A glucose-only note does not create a food item
- **WHEN** an item's name is only glucose text with no food and zero portions
- **THEN** no meal item is created for it, but its glucose is still extracted

#### Scenario: Re-import does not duplicate glucose or erase other vitals
- **WHEN** the same range is imported again
- **THEN** glucose readings already present (same time, value, meal context, and label — so a same-time post-meal 1hr and 2hr are not collapsed) are not appended again, and the day's weight/body-fat/BP/spo2 remain intact

### Requirement: Diet import reuses the connector's auth and error contract

The diet import SHALL use the same chaodays credentials handling and error mapping as
the weight import: credentials/token used transiently and never stored; invalid input
→ 400; wrong chaodays credentials → 400 `chaodays_auth_failed`; upstream failure → 502
`chaodays_unavailable`.

#### Scenario: Wrong credentials and upstream failures map consistently
- **WHEN** chaodays rejects sign-in, or returns a non-auth failure
- **THEN** the diet endpoint returns 400 `chaodays_auth_failed` or 502 `chaodays_unavailable` respectively

### Requirement: Import chaodays water into daily intake

An authenticated lifeos user SHALL be able to import their chaodays water records
for a date range: each day's chaodays water entries are summed and added to that
day's lifeos intake. A day that already has lifeos intake SHALL be skipped (not
double-added), making re-import idempotent. The response summarizes days imported
and skipped.

#### Scenario: A day's water entries are summed and imported
- **WHEN** a day has several chaodays water entries and no existing lifeos intake
- **THEN** that day's lifeos intake is set to the sum of those entries, and the day is counted as imported

#### Scenario: A day that already has intake is skipped
- **WHEN** a day already has lifeos water intake
- **THEN** that day is skipped (counted as skipped) and its intake is not changed

#### Scenario: A day summing to zero is not written
- **WHEN** a day's chaodays water entries sum to zero
- **THEN** no intake row is created for that day and it is not counted as imported

#### Scenario: An empty range imports nothing
- **WHEN** the range contains no chaodays records
- **THEN** the response reports zero imported and zero skipped

### Requirement: Import chaodays bowel records, aggregated per day

An authenticated lifeos user SHALL be able to import their chaodays defecation
records for a date range: each day's records aggregate into one bowel log — count is
the sum, the day is normal only if no record is flagged abnormal (chaodays records
abnormality; lifeos records normality, so the flag is inverted), and notes are
joined. A day that already has a lifeos bowel log SHALL be skipped.

#### Scenario: A day's defecation records aggregate into one bowel log
- **WHEN** a day has chaodays defecation records (counts, an abnormality flag, notes) and no existing lifeos bowel log
- **THEN** a bowel log is set for that day with the summed count, isNormal = not any abnormal, and the joined notes, counted as imported

#### Scenario: The abnormality flag is inverted to normality
- **WHEN** a day's chaodays records include one marked abnormal (is_abnormality true)
- **THEN** the imported day's isNormal is false

#### Scenario: A day that already has a bowel log is skipped
- **WHEN** a day already has a lifeos bowel log
- **THEN** that day is skipped and its bowel log is left unchanged

### Requirement: Water and bowel imports reuse the connector's auth and error contract

Both imports SHALL use the same chaodays credentials handling and error mapping as
the other slices: credentials/token transient and never stored; invalid input → 400;
wrong chaodays credentials → 400 `chaodays_auth_failed`; upstream failure → 502
`chaodays_unavailable`.

#### Scenario: Wrong credentials and upstream failures map consistently
- **WHEN** chaodays rejects sign-in, or returns a non-auth failure, on either endpoint
- **THEN** the endpoint returns 400 `chaodays_auth_failed` or 502 `chaodays_unavailable` respectively

### Requirement: Egress to chaodays goes through a configurable relay

The backend SHALL send its chaodays requests to a configurable base URL — a relay
when one is provisioned, the direct chaodays API otherwise — because chaodays
blocks requests originating from a Cloudflare Worker. When a relay base URL is
configured, all chaodays requests (sign-in and every data fetch) SHALL target that
base and SHALL carry a shared-secret header identifying the caller to the relay;
when it is not configured, requests SHALL go directly to the chaodays API as
before. The choice of base URL SHALL NOT change the request paths, bodies, auth
headers, session-token rotation, or the import behavior and error mapping — only
the host the request is sent to.

#### Scenario: Requests target the relay when configured
- **WHEN** the client is configured with a relay base URL and secret
- **THEN** every chaodays request (sign-in and data fetches) is sent to that base URL and includes the `X-Relay-Secret` header carrying the configured secret

#### Scenario: Requests go directly when no relay is configured
- **WHEN** no relay base URL is configured
- **THEN** requests go to the direct chaodays API base and no relay secret header is added, exactly as before this change

#### Scenario: The relay only forwards authenticated callers
- **WHEN** the relay receives a request without the correct `X-Relay-Secret` header
- **THEN** the relay rejects it with `403` and does not forward it to chaodays, so the relay never acts as an open proxy

### Requirement: Diet import uses a bounded number of DB round-trips

The diet import SHALL read and write the database in a number of round-trips that
does not grow per day, so that importing a multi-week range does not exceed the
Workers per-invocation subrequest limit. It SHALL read existing meals and existing
vitals for the whole range in a bounded number of queries (not one per day), and it
SHALL write the created meals (entries and items) and the updated vitals via batched
operations rather than a separate statement per meal, item, or day. All existing
diet-import behavior — per-(day, meal) idempotency, merging same-type records,
glucose extraction and de-duplication, preservation of a day's other vitals, and the
summary shape — SHALL be unchanged.

#### Scenario: A multi-day range imports within the subrequest budget
- **WHEN** a diet import covers many days, each with several meals and food items
- **THEN** the import reads existing meals and vitals for the range in a bounded number of queries and persists all new meals, items, and vitals via batched writes, rather than issuing statements proportional to days × meals × items

#### Scenario: Idempotency and glucose de-duplication are preserved under batching
- **WHEN** the same range is imported twice
- **THEN** a (day, meal) that already existed is still skipped, same-type records on a day still merge into one meal, and glucose readings already present are not appended again, exactly as before batching

### Requirement: Imported diet meals use lifeos meal codes and the record's local time

The diet import SHALL record each imported meal under lifeos's standard meal code —
`breakfast`, `lunch`, or `dinner` — for chaodays breakfast/lunch/dinner records, and
as a snack for chaodays extra records, rather than under a localized display name, so
imported meals appear as the real standard meals rather than custom-named snacks. The
import SHALL also store each meal's time interpreted at the chaodays record's local
(Taiwan) timezone offset, so the stored instant matches the wall-clock time the user
recorded rather than being shifted by the runtime's UTC assumption.

#### Scenario: A breakfast record imports as the standard breakfast meal
- **WHEN** a chaodays record of type breakfast (or lunch/dinner) is imported
- **THEN** its lifeos meal is the code `breakfast` (or `lunch`/`dinner`), which the app shows as the real standard meal — not a snack named after the localized label

#### Scenario: An extra record imports as a snack
- **WHEN** a chaodays record of type extra is imported
- **THEN** it becomes a snack meal, not a standard meal

#### Scenario: Meal time reflects the record's local timezone
- **WHEN** a chaodays record has `recorded_at` of `08:30` local time
- **THEN** the meal's stored instant corresponds to `08:30` at the record's local (Taiwan, +08:00) offset, not `08:30` UTC

### Requirement: Weight, water, and bowel imports use a bounded number of DB round-trips

The weight, water, and bowel imports SHALL read and write the database in a number of
round-trips that does not grow per day, so importing a multi-week range does not
exceed the Workers per-invocation subrequest limit. Each SHALL read the existing data
for the whole range in a bounded number of queries (not one per day) and persist the
imported days via batched writes rather than a statement per day. All existing import
behavior — per-day idempotency (skip a day that already has data), weight/body-fat
preservation, water summing and zero-skip, bowel aggregation and abnormality
inversion, and the summaries — SHALL be unchanged.

#### Scenario: A multi-week weight/water/bowel range imports within the subrequest budget
- **WHEN** a weight, water, or bowel import covers many days
- **THEN** it reads existing data for the range in a bounded number of queries and persists all imported days via batched writes, not statements proportional to the number of days

#### Scenario: Idempotency preserved under batching
- **WHEN** the same range is imported twice
- **THEN** a day that already had lifeos data is still skipped and left unchanged, exactly as before batching

### Requirement: Chaodays extra records import as separate time-keyed snacks

The diet import SHALL import a day's chaodays extra records as separate snack meals
keyed by time rather than merging them into a single snack: records that share the
same `recorded_at` time merge into one snack, and each distinct time becomes its own
snack meal with that time and its own items. Each new snack SHALL be named by the
app's snack-naming rule — the base snack word for the first, then the base word
followed by one more than the highest snack number already present that day. A snack
time that already has a snack in lifeos for that day SHALL be skipped, so re-importing
the same range adds no duplicate snacks. Standard meals (breakfast/lunch/dinner),
glucose extraction and de-duplication, and the meal time's timezone handling SHALL be
unchanged.

#### Scenario: Multiple extra records at different times become separate snacks
- **WHEN** a day has three chaodays extra records at three different times, none pre-existing
- **THEN** three separate snack meals are created — the first named the base snack word and the next two the base word plus an incrementing number — each carrying its own time and items, rather than one merged snack

#### Scenario: Extra records at the same time merge into one snack
- **WHEN** two chaodays extra records on a day share the same `recorded_at` time
- **THEN** their items are imported into a single snack for that time

#### Scenario: Re-import does not duplicate snacks
- **WHEN** a range is imported again and a snack already exists at a given day and time
- **THEN** no additional snack is created for that time

