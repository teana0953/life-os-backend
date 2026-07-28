## ADDED Requirements

### Requirement: Import chaodays menstrual periods

The import SHALL support pulling the user's menstrual periods from chaodays for a date
range, mapping each source period's start and end dates onto a lifeos period. Source fields
lifeos has no home for SHALL be dropped rather than approximated.

#### Scenario: Periods in the range are imported
- **WHEN** the user imports a range in which chaodays has recorded completed periods
- **THEN** each of those periods is created in lifeos with the same start and end dates

#### Scenario: Fields lifeos cannot hold are dropped
- **WHEN** a source period carries a day count and a free-text note
- **THEN** neither is invented into lifeos data; only the dates are imported

#### Scenario: An imported period is subject to the same validation as a manual one
- **WHEN** a source period ends before it starts
- **THEN** the import fails as an upstream problem rather than storing a period that could
  not have been entered by hand

### Requirement: A period still open upstream is not imported

The import SHALL skip a source period that has no end date, because it is data that has not
finished changing. Importing it as an open lifeos period would silently suppress every
later import — an open period cannot be shown not to overlap anything after it — and would
need manual editing to undo. Skipping it costs only a re-import once the period ends.

#### Scenario: An ongoing period is left for a later import
- **WHEN** the range includes a period chaodays has not yet closed
- **THEN** nothing is written for it, and importing again after it is closed brings it in

### Requirement: The menstrual source is read to the end of its pagination

Unlike the other chaodays collections, the menstrual endpoint paginates. The import SHALL
read every page for the requested range, so the result does not depend on how many periods
happen to fall in it, and SHALL carry the rotated session from each response into the next
request. The number of pages read SHALL be bounded so a misbehaving upstream fails rather
than looping.

#### Scenario: A range spanning more than one page is fully imported
- **WHEN** the periods in the requested range do not fit in a single page
- **THEN** the import fetches the following pages and imports the periods from all of them

#### Scenario: Paging stops on a page that returns nothing
- **WHEN** a page comes back with no periods
- **THEN** no further page is requested for that range

#### Scenario: A page shorter than requested is not assumed to be the last
- **WHEN** a page comes back with fewer periods than were asked for and a following page
  still has periods
- **THEN** those following periods are imported too

#### Scenario: Paging uses the session the previous page returned
- **WHEN** the import requests a page after the first
- **THEN** it presents the session returned by the immediately preceding response

#### Scenario: Endless pagination fails instead of looping
- **WHEN** the upstream keeps reporting further pages past a sane limit
- **THEN** the import fails as an upstream problem rather than issuing unbounded requests

### Requirement: Periods overlapping already-known periods are skipped

A source period whose dates overlap any period already known SHALL be skipped, leaving
existing records untouched. Already known SHALL cover both what lifeos already stores and
what earlier in the same import was accepted, so the source repeating a period — which it
may do when one spans a fetch boundary — cannot produce two overlapping copies. Overlap —
not an identical start date — SHALL be the test, because the same real period recorded in
both places often differs by a day, and importing it again as a second overlapping period
would corrupt the cycle statistics the data exists to produce.

#### Scenario: An identical period is not duplicated
- **WHEN** the range contains a period lifeos already has with the same dates
- **THEN** nothing is written for it

#### Scenario: A period offset by a day is still recognised as the same one
- **WHEN** lifeos already records a period and the source records one that starts a day
  later but covers overlapping days
- **THEN** it is skipped rather than added as a second, overlapping period

#### Scenario: A genuinely separate period is imported
- **WHEN** a source period sits entirely outside every period already known, even
  immediately adjacent to one
- **THEN** it is imported

#### Scenario: An existing open period suppresses periods it could cover
- **WHEN** lifeos holds a period with no end date and the source has periods starting after it
- **THEN** those are skipped, because an open period cannot be shown not to overlap them

#### Scenario: Overlap is judged in both directions
- **WHEN** the source period starts before an existing period but their days overlap
- **THEN** it is skipped, exactly as when it starts after — the day-apart case the overlap
  test exists for happens in both directions

#### Scenario: The source repeating a period within one import writes it once
- **WHEN** the same period comes back more than once while reading the requested range
- **THEN** it is stored once

#### Scenario: Re-running the import writes nothing new
- **WHEN** the user runs the same import twice
- **THEN** the second run adds no periods

### Requirement: The menstrual summary does not depend on how the range was split

The counts the import reports SHALL be the same whether the range was fetched in one batch
or several, as they are for every other chaodays import. Because this source may return the
same period while reading more than one batch, a period the source repeats SHALL be counted
once, not once per time it was seen.

#### Scenario: Splitting the range does not change the counts
- **WHEN** the same range is imported as one request and as several batches, and a period
  falls where the batches meet
- **THEN** the periods written and the reported counts are identical

#### Scenario: A period that is not written is reported as skipped
- **WHEN** a period is left out, whether because it overlaps a known period or because it
  has not ended yet
- **THEN** it is counted among the skipped ones

### Requirement: A failed menstrual import writes nothing

The import SHALL surface any failed request for the range — whether a batch or a page
within it — using the existing error contract, and SHALL NOT have written any of the
periods, so a retry is a clean retry.

#### Scenario: A mid-range failure aborts without partial writes
- **WHEN** an earlier request returns periods that would be imported and a later request fails
- **THEN** the import fails with the same error mapping as any other chaodays import, and
  none of the earlier periods have been written
