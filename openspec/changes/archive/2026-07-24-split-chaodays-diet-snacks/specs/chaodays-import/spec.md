## ADDED Requirements

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
