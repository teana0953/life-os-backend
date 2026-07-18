## Why

The frontend UX/UI review of the diet module settled three refinements that need
backend support before the Flutter UI can implement them: logging a dictionary
item with a real amount (not just one unit), entering that amount by grams, and
ordering a day's meals and snacks by when they were **eaten** rather than when
they were recorded. This extends the merged `diet-tracking` and `food-dictionary`
capabilities.

## What Changes

- **Quantity multiplier**: logging from a dictionary item accepts a `quantity`
  (default 1, decimals allowed). The entry's portions and nutrients become the
  dictionary item's values × quantity.
- **Base grams + gram entry**: `food_item` gains a nullable `base_grams` — the
  gram weight of one dictionary unit. A gram amount converts to a quantity as
  `grams ÷ base_grams`; items without `base_grams` support only unit multiples.
  The seed backfills `base_grams` for rows whose name encodes grams (`飯/50g`
  → 50); household-unit rows (`飯/1碗`, `香蕉/1根`) stay null.
- **Eaten-at time + ordering**: `food_entry` gains `eaten_at` (defaults to now,
  user-settable), distinct from the system-assigned `logged_at`. A day's diet
  log orders entries by `eaten_at`, so meals and snacks sort by when they were
  eaten and back-dated entries land in the right place.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `diet-tracking`: dictionary logging takes a `quantity` that scales portions
  and nutrients; a gram amount can be converted via the item's `base_grams`;
  entries carry a user-settable `eaten_at`; a day's log orders by `eaten_at`.
- `food-dictionary`: items carry an optional `base_grams`; the seed backfills it
  for rows whose unit is a gram amount.

## Impact

- **DB**: `food_item.base_grams` (nullable numeric) and `food_entry.eaten_at`
  (timestamptz, default now) added; one new Drizzle migration.
- **Domain**: a gram→quantity conversion and quantity scaling of portions and
  nutrients in `health/domain`.
- **HTTP**: `POST /api/diet-entries` accepts optional `quantity`, `grams`, and
  `eaten_at`.
- **Seed**: `base_grams` backfilled from item names; the 271-row dictionary is
  re-seeded (`npm run db:seed`).
- **No breaking change**: `quantity` defaults to 1, `eaten_at` defaults to now,
  and `base_grams` is nullable — existing requests behave exactly as before when
  the new fields are omitted.
