## ADDED Requirements

### Requirement: Long date ranges are fetched from chaodays in batches

An import SHALL fetch a date range longer than the batch size as several consecutive
upstream requests covering the whole range, rather than as one request the upstream
rejects. The batches SHALL be contiguous and non-overlapping and together SHALL cover
exactly the requested range, so the imported data is identical to what a single request
for the whole range would have produced.

The batch boundaries SHALL be derived from a fixed number of days, so that the split
points do not depend on which calendar month the range starts in.

#### Scenario: A long range is fetched in several requests
- **WHEN** an import covers a range longer than the batch size
- **THEN** the upstream is asked for several consecutive sub-ranges that together cover
  exactly the requested range, with no gap and no overlap

#### Scenario: A short range is still a single request
- **WHEN** an import covers a range within the batch size
- **THEN** the upstream is asked once, for the whole range, as before

#### Scenario: The result does not depend on how the range was split
- **WHEN** the same range is imported as one request and as several batches
- **THEN** the records written, the skipped counts, and the returned summary are the same

### Requirement: Batched imports sign in once and reuse the rotated session

An import SHALL sign in to chaodays once per run regardless of how many batches the
range is split into, and SHALL carry the session returned by each upstream response into
the next request. Splitting a range SHALL NOT multiply the number of sign-ins.

#### Scenario: Splitting a range does not multiply sign-ins
- **WHEN** an import covers a range that is split into several batches
- **THEN** the run signs in exactly once

#### Scenario: Each batch uses the session the previous response returned
- **WHEN** an import issues a second or later batch request
- **THEN** it presents the session returned by the immediately preceding response, not the
  one obtained at sign-in

### Requirement: A failed batch fails the import without partial writes

When any batch fails, the import SHALL surface the failure with its existing error
contract and SHALL NOT write part of the range, so a retry is a clean retry.

#### Scenario: A mid-range upstream failure aborts the import
- **WHEN** a batch after the first fails
- **THEN** the import fails with the same error mapping as a single-request failure, and
  no records from the earlier batches have been written

#### Scenario: Auth failures are unchanged
- **WHEN** the sign-in or any batch is rejected for bad chaodays credentials
- **THEN** the import reports the auth failure exactly as it does today
