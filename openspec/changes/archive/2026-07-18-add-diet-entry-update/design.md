# Design: add-diet-entry-update

## Context

Extends the merged `diet-tracking` capability with an update path so the frontend
can edit past entries. Same stack: Hono + Drizzle → Neon, Firebase auth, Clean
Architecture / DDD in `src/contexts/health`. Reuses the existing conversion
module (portions → nutrients, as `logManualFoodEntry` uses) and HTTP validation
helpers. `food_entry` already carries every field an edit touches.

## Goals / Non-Goals

**Goals**: owner-scoped partial update of an entry's name / meal / eaten-at /
portions; recompute nutrients from portions when portions change; mirror the
delete route's not-found (404) convention.

**Non-Goals**: no schema change; no change to create/delete/query; no editing of
raw nutrients directly (edits go through portions, consistent with the two-axis
model — grams/quantity are a logging-time concern, not an edit-time one).

## Decisions

### D1 — Owner scoping in the repository, like delete

`update(userId, entryId, patch)` filters by `user_id = userId` (as `delete`
does), so another user's or a missing entry updates nothing and returns `null`.
The HTTP layer maps `null` → 404, reusing the delete route's `not_found` shape.

### D2 — Portions recompute nutrients; other fields are a straight merge

The patch is partial: only supplied fields change. When `portions` is present,
the atomic nutrients are recomputed from it via the conversion module (the exact
rule `logManualFoodEntry` applies for portion input) and `unclassified` is set to
false — a portion edit is a classified entry. `name` / `meal` / `eatenAt` are
merged as given. Omitted fields keep their stored values (a single UPDATE of only
the changed columns, or a read-modify-write of the row — implementer's choice, as
long as omitted fields are untouched).

When `eatenAt` is updated, the entry's `day` bucket is derived from it (day = the
eaten-at calendar date), keeping the day column and `eaten_at` consistent —
editing the time across a day boundary moves the entry to that day rather than
leaving it stranded in its original day bucket with a mismatched time.

### D3 — Use case guards "no fields"

`UpdateFoodEntry` requires at least one updatable field in the patch; an empty
patch is invalid (the use case rejects it, and the HTTP layer returns 400 before
touching the repository).

### D4 — HTTP: PATCH with existing validators

`PATCH /api/diet-entries/:id` reads optional `name`, `meal`, `eaten_at`,
`portions`. Validates with the existing helpers (eaten_at a valid timestamp;
portion values finite ≥ 0). Empty patch → 400; not owned / missing → 404; behind
the same auth middleware as the other diet routes. Response is the updated entry
JSON, same shape as create.

## Risks / Trade-offs

- **Partial update vs full replace** → PATCH semantics (only supplied fields
  change) match the edit form, which may send only what changed. The "no fields"
  guard prevents a meaningless no-op update.
- **Recompute vs preserve nutrients on a name/meal-only edit** → nutrients are
  only recomputed when portions are supplied; a name/meal/time edit leaves
  nutrients and portions untouched.
- **numeric string↔number** for portion columns → handled in the Drizzle adapter
  like the other numeric writes.

## Open Questions

- None — this mirrors existing create/delete patterns and the manual-entry
  portion→nutrient recompute.
