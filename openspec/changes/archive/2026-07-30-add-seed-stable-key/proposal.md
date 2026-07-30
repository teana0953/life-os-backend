## Why

`add-admin-shared-food-editing` (PR #59) made two changes that quietly contradict
each other: re-running the seed now skips rows whose **name** already exists among
the shared items, and an administrator can now **edit that name**. Rename a seeded
item and the next `npm run db:seed` no longer recognizes it, so the original seed
row is inserted again — the catalog ends up holding both the renamed item and a
resurrected copy of the pre-rename row. That breaks the scenario the same change
committed to: "Re-running the seed keeps administrator changes … and no shared item
is duplicated".

The fix is to stop using a mutable field as an identity key.

## What Changes

- **`food_item.seed_key`** — a new nullable text column recording which seed row an
  item came from. Seed-created items carry it; administrator-created shared items and
  users' custom items leave it null. Migration includes a backfill
  (`seed_key = name WHERE owner_user_id IS NULL`), which is exact today: the live
  catalog holds 271 shared rows matching the 271 seed rows one-to-one, with no
  administrator-created shared item and no rename performed yet.
- **A partial unique index** on `seed_key` (where not null), so "one seed row can
  never appear twice" is enforced by the database rather than only by the seed's own
  filter.
- **`seedFoodDictionary` keys off `seed_key`** instead of `name`, both when deciding
  what to skip and when inserting; the `--force` full-refresh path writes it too. The
  returned `{ inserted, skipped }` shape is unchanged.
- **`seed_key` is not editable and not exposed**: it is absent from the admin PATCH
  field list, absent from the admin create payload, and absent from the API response
  shape — it is the seed's internal identity, not user data.

## Capabilities

### Modified Capabilities

- `food-dictionary`: the seed identifies its own rows by a stable key rather than by
  the item name, so an administrator renaming a seeded item no longer causes the seed
  to re-insert the original row on its next run.
