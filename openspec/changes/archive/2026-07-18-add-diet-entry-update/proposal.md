## Why

The frontend history/edit feature (viewing past days and editing entries) needs
to change already-logged entries, but the backend only creates and deletes them
today. Add an owner-scoped update to the `diet-tracking` capability.

## What Changes

- **Repository update**: `DietLogRepository.update(userId, entryId, { name?,
  meal?, eatenAt?, portions? })` — owner-scoped (another user's or a missing
  entry → null / not found). When `portions` are supplied, the atomic nutrients
  are recomputed from them via the existing conversion rules (as `logManualEntry`
  does) and the entry is marked classified (`unclassified = false`). Fields not
  supplied keep their current values. Returns the updated entry.
- **`UpdateFoodEntry` use case**: wraps the repository update; requires at least
  one updatable field, otherwise the update is invalid.
- **HTTP**: `PATCH /api/diet-entries/:id` accepting optional `name` / `meal` /
  `eaten_at` / `portions`, validated with the existing helpers (eaten_at a valid
  timestamp, portions finite; no fields at all → 400); updating a non-owned or
  missing entry → 404 (matching the delete route's not-found convention); behind
  auth.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `diet-tracking`: adds updating one of the user's own food entries — name, meal,
  eaten-at, and/or food-group portions; owner-scoped; partial; supplying portions
  recomputes nutrients and clears `unclassified`.

## Impact

- **Domain**: `update` added to the `DietLogRepository` port.
- **Application**: new `UpdateFoodEntry` use case.
- **Adapters**: `DrizzleDietLogRepository.update`; new `PATCH /api/diet-entries/:id`
  route wired from the composition root.
- **No schema change**; no change to create / delete / day-view behavior.
