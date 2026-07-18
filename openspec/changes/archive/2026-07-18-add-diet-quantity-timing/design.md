## Context

Extends the merged diet module (`openspec/changes/archive/2026-07-18-add-diet-tracking/`,
specs `diet-tracking` + `food-dictionary`). The frontend UX/UI review fixed three
behaviors the current backend can't express: a dictionary log is always exactly
one unit; there is no way to enter an amount in grams; and a day's log orders by
`logged_at` (record time), so a back-dated entry sorts wrong. Same stack: Hono +
Drizzle → Neon, Firebase auth, Clean Architecture / DDD in `src/contexts/health`.

## Goals / Non-Goals

**Goals**
- Log a dictionary item by a decimal quantity, scaling portions and nutrients.
- Enter that amount in grams where the item defines a gram unit.
- Order a day's meals/snacks by a user-settable eaten-at time, not record time.
- Backfill `base_grams` for the existing 271 seed rows where derivable.

**Non-Goals**
- No new capability; this only extends `diet-tracking` / `food-dictionary`.
- No unit system beyond the item's own unit + grams (no cups↔grams tables for
  household-unit rows — those simply keep `base_grams` null).
- Frontend implementation (Phase 2, separate).

## Decisions

### D1 — Quantity scales the atomic layer, not stored portions only

`logFoodEntryFromDictionary` takes `quantity` (default 1, finite, > 0, decimals
allowed). The new entry's nutrients **and** portions are the dictionary item's
values × quantity. Scaling both axes keeps the two-axis model consistent (D1 of
the original design): a 1.5× `飯/1碗` is 6 staple portions **and** 90 g carb.
Quantity is not persisted as a column — it is applied at creation and the scaled
values are stored, exactly like a manual entry.

### D2 — Gram entry is a thin conversion to quantity

Gram input is not a second code path: a pure domain function converts
`grams ÷ base_grams → quantity`, then D1 applies. If `base_grams` is null the
conversion is impossible, so the HTTP layer rejects a gram-based log with `400`
(reusing the `BadRequestError` → 400 mapping). This keeps "log by unit" and "log
by grams" a single scaling rule with one extra division. `grams` and `quantity`
are mutually exclusive at the HTTP boundary — supplying both returns `400` — so
there is no double-scaling ambiguity; exactly one determines the quantity.

### D3 — `eaten_at` is separate from `logged_at`; ordering uses `eaten_at`

Two timestamps with different owners:
- `logged_at` — system audit time, `defaultNow()`, **never** user-settable
  (unchanged from add-diet-tracking).
- `eaten_at` — when the food was eaten, `defaultNow()` but user-settable.

`getDayDietLog` sorts by `eaten_at` (was `logged_at`). Meal grouping still uses
first-occurrence order, so groups now appear in eaten order and a back-dated
breakfast sorts before an earlier-logged dinner. Keeping both timestamps means
we never lose the audit trail while fixing user-facing order.

### D4 — `base_grams` backfill parses the unit token from the name

Seed rows encode the unit in the name after `/` (`飯/50g`, `生米/20g`,
`熟肉(雞豬牛羊魚)/30g`, `雞胸肉水餃/140克`). The seed backfills `base_grams` only
when that unit token is a bare gram amount — matched with an anchored regex on
the unit segment that accepts both the ASCII `g` and the Chinese `克` (both mean
grams): `/\/\s*(\d+(?:\.\d+)?)\s*(?:g\b|克)/`. Anchoring to the digits right
after `/` keeps a `克` inside a brand name (`星巴克拿鐵/1杯`) from being read as
a unit. Household units (`1碗`, `1根`, `1片`, `掌心大`, `2湯匙`) don't match and
stay null. This is a seed-time heuristic on data we control; wrong/edge parses
are correctable per item.

### D5 — Schema delta

```
food_item   + base_grams  numeric NULL          -- gram weight of one unit
food_entry  + eaten_at    timestamptz NOT NULL DEFAULT now()   -- user meal time
```
Both are additive and safe on existing rows: `base_grams` is nullable; `eaten_at`
defaults to now (existing rows, if any, get their migration time — acceptable for
a dev-only dataset that is re-seeded anyway).

## Risks / Trade-offs

- **`eaten_at` default for pre-existing rows** → migration stamps them `now()`.
  Acceptable: the only data is the re-seeded dev dictionary and any throwaway dev
  entries; no production data exists.
- **Gram regex mis-parses an odd name** → only affects `base_grams` (an optional
  convenience); the item still logs by unit. Correctable per row; not a blocker.
- **quantity = 0 or negative** → validated at the HTTP boundary (finite, > 0)
  via the existing validation helpers, returning `400`.
- **numeric string↔number** in Drizzle for `base_grams` → handled in the repo
  adapter like the other numeric columns; domain works in numbers, null stays
  null.

## Open Questions

- Should `quantity` itself be persisted on the entry (for later "edit amount")?
  For now no — the scaled values are the source of truth and an edit re-logs.
  Revisit if the UI wants to show/adjust the original amount after saving.
