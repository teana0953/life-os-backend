## ADDED Requirements

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
