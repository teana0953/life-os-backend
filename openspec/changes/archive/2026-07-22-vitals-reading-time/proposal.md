## Why

Each vitals measurement list (blood pressure, glucose, blood oxygen) holds
multiple readings a day, but a reading has no time — so several readings on the
same day can't be ordered or told apart. Add a required time (HH:mm within the
day) to every reading. Backend half; the frontend time picker is a separate
life-os change.

## What Changes

- **Each reading gains a `time`** (a `HH:mm` string): `bp_readings`,
  `glucose_readings`, and `spo2_readings` items now carry `time` alongside their
  existing fields. The three arrays are `jsonb` (schemaless), so this needs NO
  migration — only the domain types and route validation change.
- **`PUT /api/vitals` requires a time per reading**: each reading must include a
  non-empty `time` string, else the request is rejected with 400.
- **Reads tolerate legacy readings without a time**: a reading persisted before
  this change (no `time` field) reads back with an empty `time`, so old data
  doesn't break.
- No new endpoint, no schema/migration, no change to the scalars or to the other
  trackers.

## Capabilities

### Modified Capabilities

- `vitals-tracking`: every blood-pressure, glucose, and blood-oxygen reading now
  carries a time (HH:mm), required when writing; reads tolerate older readings
  that predate the time field.
