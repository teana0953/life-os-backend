## ADDED Requirements

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
