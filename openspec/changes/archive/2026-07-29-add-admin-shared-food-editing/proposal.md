## Why

The shared food dictionary is seeded from a 271-row table whose nutrients are
derived (no fat estimate) and whose measure basis is backfilled from name
tokens — the `food-dictionary` spec already says seeded values "MAY be corrected
per food item later". Today there is no way to correct them: the API exposes
search, create-**custom** (private to its owner), and favorites, but **no update
path at all**, and the codebase has **no notion of an administrator** (`users`
holds only firebase_uid / email / display_name / timezone).

[life-os#87](https://github.com/teana0953/life-os/issues/87) asks for an admin
who can freely edit the food dictionary. This change is the backend half:
the admin flag, and the two shared-catalog write endpoints. The frontend editing
entry point (inline in the food search screen) is a separate `life-os` change.

## What Changes

- **`users.is_admin`** — a new `boolean NOT NULL DEFAULT false` column plus a
  Drizzle migration; surfaced as `User.isAdmin` in the domain and as `is_admin`
  in the `GET /api/me` payload, so the (separate) frontend change can decide
  whether to show an editing entry point without probing for a 403. Granting
  admin is a manual SQL operation for now (no user-management UI in scope, and
  no endpoint that sets the flag).
- **Admin authorization** — `resolveAdminUser(userRepository, claims)` resolves
  the caller (get-or-create, as today) and returns `null` unless `isAdmin`;
  handlers turn `null` into `403 { error: "forbidden" }`. Missing/invalid tokens
  keep returning `401` from the existing auth middleware.
- **`POST /api/admin/food-items`** — creates a **shared** item
  (`owner_user_id = null`, visible to every user). Same payload as the existing
  custom-item endpoint plus optional `base_amount` + `measure_unit`. Returns
  `201` with the item.
- **`PATCH /api/admin/food-items/:id`** — partial update of a **shared** item:
  `name`, the six nutrients, the four portions, `base_amount`, `measure_unit`.
  Only the fields present in the body change; `id` / `owner_user_id` /
  `created_at` are not editable. Returns `200` with the updated item. A target
  that does not exist — or that is some user's private custom item — returns
  `404` (indistinguishable, so private items are not disclosed). An empty patch
  returns `400`.
- **Measure-basis invariant enforced on write** — `base_amount` and
  `measure_unit` must be both present or both null in the item's **post-patch**
  state; violations return `400`. The invariant was previously only a property of
  the seed, since nothing could write these fields.
- **`FoodDictionaryRepository` port grows** `findSharedById`, `createShared`,
  `updateSharedById`; existing `search` / `findById` / `createCustom` / favorites are
  untouched, so read behavior for regular users is unchanged.
- **The seed stops clobbering the shared catalog** — `npm run db:seed`
  (`run-seed.ts`) today deletes every `owner_user_id IS NULL` row and reinserts
  from the seed file, which would silently erase every admin correction and
  admin-created item (and cascade-delete their favorites). It changes to
  insert-only-what-is-missing (matched by name), with the old destructive
  behavior kept behind an explicit `--force` flag for refreshing the seed data
  file on a throwaway database.
- **Not changed**: editing another user's custom item, deleting shared items,
  audit logging, and any user-facing UI are explicitly out of scope. Existing
  meal records are snapshots (`meal_item` carries its own nutrients and
  portions), so editing a dictionary item never rewrites logged history — this is
  pinned as a scenario rather than left implicit.

## Capabilities

### Modified Capabilities

- `food-dictionary`: the shared (seeded) catalog becomes writable — an
  administrator can create shared items and correct the fields of existing ones
  through admin-only endpoints, with the measure-basis invariant enforced at
  write time and logged meals unaffected; re-running the seed no longer discards
  those administrator changes.
- `user-account`: a user record additionally carries an administrator flag,
  defaulting to false, which gates admin-only endpoints and is reported by the
  current-user endpoint.
