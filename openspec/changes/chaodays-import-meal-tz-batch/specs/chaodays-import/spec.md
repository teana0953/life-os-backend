## ADDED Requirements

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
