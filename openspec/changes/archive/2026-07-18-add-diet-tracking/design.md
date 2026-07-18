## Context

LifeOS is adding its first health-domain capability. Prior exploration (captured
in `docs/research/chaodays-health-tracking.md`) studied chaodays.app and
reverse-engineered the user's 271-row food→portion spreadsheet, establishing
that Taiwan's portion-exchange (份數) system is a **lossy integer packing of
underlying nutrients**: each portion is defined by a fixed nutrient anchor
(staple = 15 g carb, meat = 7 g protein, fruit = 15 g carb ≈ 60 kcal, veg = 5 g
carb). The user is single-tenant (self-use), wants precise manual input now and
AI-photo estimation later, and confirmed sugar/fiber should be stored.

Backend constraints (see repo `CLAUDE.md`): Cloudflare Workers + Hono, Drizzle →
Neon Postgres, Firebase-verified auth, Clean Architecture / DDD with a
context-first layout. New business modules become a context under
`src/contexts/`.

## Goals / Non-Goals

**Goals:**
- Store diet data in a form that survives the shift from manual portion input to
  AI nutrient estimation without a data migration.
- Reproduce the useful chaodays behaviors: per-meal logging, per-day portion
  targets with a remaining view, a household-unit food dictionary.
- Seed the dictionary from the user's existing 271 rows.
- Keep the conversion math as pure, unit-tested domain logic.

**Non-Goals:**
- Automatic daily-target computation from body metrics (needs sex/height/weight
  fields + a TDEE→portion formula — a separate decision). Targets are set
  explicitly here.
- The exercise, weight/body-fat, water, bowel, and period modules.
- Actual AI-photo estimation. Only the `source` seam and nutrient-first store
  are added so that feature drops in later without schema change.
- Multi-user concerns beyond the existing per-user auth scoping.

## Decisions

### D1 — Two orthogonal axes: nutrient quantity + food-group attribution

The exploration slogan was "store nutrients, portions are a projection." Writing
the spec surfaced a subtlety that refines it: **nutrients and food groups are
two independent axes.** Grams answer *how much*; they cannot answer *which food
group* — 15 g of carbohydrate is 1 staple portion **or** 1 fruit portion, and
that classification is human knowledge (a nutritionist decided a cake's sugar is
booked against the "fruit" column). It is not recoverable from grams.

Therefore each `food_entry` (and each `food_item`) stores **both**:
- Atomic nutrients `{ carb_g, protein_g, fat_g, sugar_g, fiber_g, kcal }` — the
  authority for calorie and nutrient totals.
- Food-group portion attribution `{ staple, meat, fruit, veg }` — the authority
  for the portion/target view.

These are deliberately allowed to **not round-trip**: a snack booked as
`staple 2 + fruit 1` may carry `carb_g 45, sugar_g 15`; projecting portions from
carb alone would give 3 staple, which is wrong. So portions are **stored, not
derived**, whenever a categorization exists (manual/dict input). Calories are
**always** derived from nutrients and **never** from portions.

Alternatives considered:
- *Portions only* (chaodays / the spreadsheet): lossy, can't absorb AI nutrient
  output, can't answer sugar/fiber. Rejected — it's the very limitation we found.
- *Pure nutrients only, derive portions*: loses the staple-vs-fruit
  categorization and mis-projects sugar-as-fruit foods. Rejected.
- *Store both* (chosen): each axis authoritative for its own view; small
  redundancy, no information loss, AI-ready.

### D2 — Conversion is pure domain logic

A single module in `contexts/health/domain` holds the divisors and the
kcal-from-macros fallback (`carb×4 + protein×4 + fat×9`, used only when an
explicit label/AI kcal is absent). It is plain Vitest unit-tested against the
calibration points recovered from the spreadsheet (生米20g→1 staple,
蛋1個→1 meat, etc.). No Workers runtime needed.

### D3 — Dictionary seed converts portions → nutrients once

The 271 rows store portions. A seed script converts each row to estimated
nutrients via D2's divisors and inserts `food_item` rows carrying both axes.
Shared (seeded) items have `owner_user_id = NULL`; user-custom items set the
owner. A user's search returns shared items ∪ their own. This makes the seed a
one-time projection at write time, not a runtime concern.

### D4 — `daily_target` is self-contained

`daily_target` stores per-day base goals `{ staple, meat, fruit, veg }` and a
parallel `bonus` set (default 0) reserved for future exercise-earned portions;
effective target = base + bonus. This avoids depending on body-metric fields the
`users` table does not yet have, keeping the change from spilling into a
TDEE-formula decision. Automatic goal computation is deferred (Open Questions).

### D5 — Schema shape (Drizzle → Neon)

New tables (grams and portions as `numeric` to allow decimals like 0.5 portions):

```
food_item      id, owner_user_id?(FK users, null=shared), name,
               carb_g, protein_g, fat_g, sugar_g, fiber_g, kcal,
               staple, meat, fruit, veg, created_at
food_favorite  user_id(FK), food_item_id(FK)                 -- (user, item) unique
food_entry     id, user_id(FK), day(date), meal(text), name?, photo_ref?,
               source('manual'|'ai_photo'|'dict'), unclassified(bool, default false),
               carb_g, protein_g, fat_g, sugar_g, fiber_g, kcal,
               staple, meat, fruit, veg, logged_at
daily_target   id, user_id(FK), day(date),                    -- (user, day) unique
               base_staple, base_meat, base_fruit, base_veg,
               bonus_staple, bonus_meat, bonus_fruit, bonus_veg
```

HTTP routes (thin Hono driving adapter, injected from `src/index.ts`): dictionary
search / favorite, diet entry create + day-view + delete grouped by day+meal,
daily-target get/set with a remaining view. Repository ports live in `domain/`;
`Drizzle*Repository` driven adapters implement them. (Entry update/edit is
deferred — delete + re-log covers correcting a mis-logged entry for v1.)

### D6 — Four portion groups; `sugar_g` is a subset of `carb_g`

The portion axis models four groups `{ staple, meat, fruit, veg }`, not the full
六大類. Oil and sugar are intentionally dropped as portion/target axes: this
matches the user's 271-row source table (every row books only these four; oil is
folded into meat, sugar into fruit) and the target shape (主食/肉類/水果/蔬菜).
Verified: the source table has no oil-only or sugar-only rows that would seed to
all-zero nutrients. Nutrient loss from that folding is recovered at the atomic
layer, where `fat_g` and `sugar_g` are stored independently.

`sugar_g` is defined as a **subset** of `carb_g` (nutrition-label convention), so
the kcal fallback `carb×4 + protein×4 + fat×9` counts sugar once (no
double-count). For fruit-as-sugar seed rows, seeded `sugar_g` MAY be set equal to
the derived carbohydrate; because it is a subset it does not change kcal.

## Risks / Trade-offs

- **Two stored axes can drift** (portions and nutrients written
  inconsistently) → For portion-carrying writes (dict, or manual with portions),
  the use case derives nutrients from portions (portion→nutrient only) so both
  are written together. Nutrient-only writes (`ai_photo`, or manual nutrients)
  are stored `unclassified` with zero portions — the system never infers
  portions from nutrients, honoring D1.
- **Seed nutrients are estimates**, not measured values (portions are integers,
  the inverse is approximate) → Acceptable: dictionary items are guidance, and
  the atomic layer can be corrected per-food later without schema change.
- **No body-metric-driven targets yet** may feel incomplete vs chaodays → Users
  set targets explicitly; the `bonus` seam and a later profile change close the
  gap without reshaping data.
- **`numeric` arithmetic** in Postgres/Drizzle needs care (string vs number) →
  Centralize parsing in the repository adapter; domain works in numbers.

## Open Questions

- Target auto-computation: which formula maps body metrics → daily portion goals?
  chaodays uses an opaque "team" calculation; this needs its own exploration and
  the sex/height/weight/goal fields on the user profile.
- Meal model: fixed enum + free snack label vs fully free-text meal — starting
  with standard meals + optional snack label; revisit if custom meals are wanted.
