## MODIFIED Requirements

### Requirement: Per-day vitals record

The system SHALL persist, per user and per calendar day, a vitals record holding weight and body fat (each an optional scalar recorded only when measured) plus three lists of repeated measurements: blood-pressure readings (each with systolic, diastolic, and the pulse it was taken with), blood-glucose readings (each with a label and a mg/dL value), and blood-oxygen readings (each with an SpO₂ percentage and an optional pulse). Every reading SHALL also carry a time (an `HH:mm` time-of-day), required when writing so several readings on the same day can be told apart; a reading persisted before the time field existed SHALL read back with an empty time so older data does not break. The scalars SHALL be nullable and each list SHALL default to empty. Reading a day with no record SHALL report both scalars null and three empty lists. Writing SHALL upsert the whole day's record — both scalars and all three lists together.

#### Scenario: Reading an unrecorded day returns empty defaults
- **WHEN** a user reads a day with no vitals record
- **THEN** the day reports weight and body fat null and empty blood-pressure, glucose, and blood-oxygen lists

#### Scenario: Writing upserts scalars and all three lists
- **WHEN** a user sets a day to weight 65.5, two blood-pressure readings (120/80 pulse 70 at 08:30, 118/78 pulse 72 at 21:00), one glucose reading ("餐前" 95 at 07:45), and one blood-oxygen reading (98% pulse 71 at 08:30)
- **THEN** reading that day returns weight 65.5 and those blood-pressure, glucose, and blood-oxygen readings, each with its time, in order

#### Scenario: A pulse may be omitted from a reading
- **WHEN** a blood-oxygen reading is recorded with an SpO₂ and a time but no pulse
- **THEN** that reading is stored with a null pulse

#### Scenario: A reading without a time is rejected on write
- **WHEN** a write includes a reading with no time (or an empty time)
- **THEN** the request is rejected with a client error

#### Scenario: A legacy reading without a time reads back empty
- **WHEN** a reading stored before the time field existed is read
- **THEN** it reads back with an empty time rather than failing
