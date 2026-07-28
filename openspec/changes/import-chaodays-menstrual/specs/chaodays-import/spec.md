## ADDED Requirements

### Requirement: Import chaodays menstrual periods

The import SHALL support pulling the user's menstrual periods from chaodays for a date
range, mapping each source period's start and end dates onto a lifeos period. Source fields
lifeos has no home for SHALL be dropped rather than approximated. A period that is still
open upstream (no end date) SHALL be imported as an open period, not given a made-up end.

#### Scenario: Periods in the range are imported
- **WHEN** the user imports a range in which chaodays has recorded periods
- **THEN** each of those periods is created in lifeos with the same start and end dates

#### Scenario: An open period stays open
- **WHEN** a source period has no end date
- **THEN** it is imported as a period with no end date

#### Scenario: Fields lifeos cannot hold are dropped
- **WHEN** a source period carries a day count and a free-text note
- **THEN** neither is invented into lifeos data; only the dates are imported

### Requirement: The menstrual source is read to the end of its pagination

Unlike the other chaodays collections, the menstrual endpoint paginates. The import SHALL
read every page for the requested range, so the result does not depend on how many periods
happen to fall in it, and SHALL carry the rotated session from each response into the next
request.

#### Scenario: A range spanning more than one page is fully imported
- **WHEN** the periods in the requested range do not fit in a single page
- **THEN** the import fetches the following pages and imports the periods from all of them

#### Scenario: A single page is a single request
- **WHEN** all the periods in the range fit in one page
- **THEN** only one request is made for that range

#### Scenario: Paging uses the session the previous page returned
- **WHEN** the import requests a page after the first
- **THEN** it presents the session returned by the immediately preceding response

### Requirement: Periods overlapping existing lifeos data are skipped

A source period whose dates overlap any period already recorded in lifeos SHALL be skipped,
leaving the existing record untouched. Overlap — not an identical start date — SHALL be the
test, because the same real period recorded in both places often differs by a day, and
importing it again as a second overlapping period would corrupt the cycle statistics the
data exists to produce.

#### Scenario: An identical period is not duplicated
- **WHEN** the range contains a period lifeos already has with the same dates
- **THEN** nothing is written for it

#### Scenario: A period offset by a day is still recognised as the same one
- **WHEN** lifeos already records a period and the source records one that starts a day
  later but covers overlapping days
- **THEN** it is skipped rather than added as a second, overlapping period

#### Scenario: A genuinely separate period is imported
- **WHEN** a source period sits entirely outside every period lifeos already has, even
  immediately adjacent to one
- **THEN** it is imported

#### Scenario: An existing open period suppresses later imports
- **WHEN** lifeos holds a period with no end date and the source has periods starting after it
- **THEN** those are skipped, because an open period cannot be shown not to overlap them

#### Scenario: Re-running the import writes nothing new
- **WHEN** the user runs the same import twice
- **THEN** the second run adds no periods

### Requirement: A failed menstrual import writes nothing

When any request for the range fails — whether a batch or a page within it — the import
SHALL surface the failure with the existing error contract and SHALL NOT have written any
of the periods, so a retry is a clean retry.

#### Scenario: A mid-range failure aborts without partial writes
- **WHEN** a request after the first fails
- **THEN** the import fails with the same error mapping as any other chaodays import, and no
  periods from the earlier requests have been written
