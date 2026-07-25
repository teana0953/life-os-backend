# Design — import chaodays diet targets (daily portion + water target)

## Context

chaodays `GET /users/diet_menus?start_date&end_date` returns per-day targets:
`{ id, date, staple/meat/fruit/veg/oil/sugar (portion targets), water (target ml),
sum_* (actual sums), content (notes) }`. lifeos has a `daily_target` table
(`baseStaple/Meat/Fruit/Veg` + exercise `bonus*`, unique (user, day)) and a separate
water target (`WaterRepository` `getTarget`/`setTarget`, `WaterTarget{ targetMl }`).
This adds a 5th chaodays importer (alongside weight/diet/water/bowel), full-stack;
this change is the **backend** slice.

## Decision

New `importChaodaysDietTarget` use case + `POST /api/import/chaodays/diet-target`,
mirroring the other importers (transient creds, same auth/error mapping, batched,
idempotent):

- Client: `fetchDietMenus(session, from, to)` → `ChaodaysDietMenu[]`
  `{ date, staple, meat, fruit, veg, waterTargetMl }` — **drop oil/sugar, content,
  sum_***. Map raw `water` → `waterTargetMl` (null → 0).
- Use case: sign in, fetch menus; read existing `dailyTarget.listInRange` and water
  `listTargetRange` (new) once each; then per day:
  - **Portion target:** set `baseStaple/Meat/Fruit/Veg` from the menu ONLY when the
    menu has **at least one non-zero portion** (staple/meat/fruit/veg > 0) AND the day
    has no existing `daily_target`; `bonus*` left at default (import sets only the base
    target). **Skip a menu whose portions are all zero** — writing an explicit all-zero
    daily target would (1) clobber the day's carry-forward standing target
    (`getLatestOnOrBefore` inheritance) and (2) permanently block a later real import
    for that day via idempotency, so a wide range that emits empty menus must not
    poison those days. A day that already has a target is skipped (not clobbered — its
    exercise bonus is preserved). All-zero and pre-existing days count as skipped.
  - **Water target:** if the day has no existing water target AND the menu's
    `waterTargetMl > 0`, set the water target. Existing water target → skip; a menu
    with no water target (0) → not written.
  - Persist via one `dailyTargetRepository.setMany` + one
    `waterRepository.setTargetMany` (both new — batched to stay under the Workers
    subrequest cap, like the other importers).
- Summary: `{ portionTargetsImported, portionTargetsSkipped, waterTargetsImported,
  waterTargetsSkipped, from, to }`.

## Repository additions (adapters use db.batch; in-memory fakes mirror)

- `DailyTargetRepository.setMany(rows: SetDailyTargetInput[]): Promise<void>` — one
  `db.batch` of per-row upserts on (user, day); empty → no-op. (`listInRange` exists.)
- `WaterRepository.listTargetRange(userId, from, to): Promise<WaterTarget[]>` — one
  SELECT; and `setTargetMany(rows: SetWaterTargetInput[]): Promise<void>` — one
  `db.batch` of per-row upserts on (user, day); empty → no-op.

## Route + wiring

`createImportChaodaysDietTargetHandler({ userRepository, dailyTargetRepository,
waterRepository, chaodaysClient })`, validating `chaodays_uid`/`chaodays_password`/
`start_date`/`end_date` like the siblings; registered at
`POST /api/import/chaodays/diet-target`; wired from the composition root (all repos
already built there).

## Error/behavior contract (same as other importers)

Invalid input → 400; wrong chaodays creds → 400 `chaodays_auth_failed`; upstream
failure → 502 `chaodays_unavailable`; creds transient, never stored. Idempotent
per (day) per target kind. Bounded, range-independent DB round-trips.

## Scope

Backend only (client + use case + route + 3 new repo methods + wiring + tests). The
frontend (add "diet target" to the chaodays import screen) is a follow-up change in
the `life-os` repo. Gate = `npm test` + `npm run typecheck`.

## Testing

- diet_menus mapped (oil/sugar/content/sum_* dropped; water→waterTargetMl).
- portion target imported per day; day with existing daily_target skipped (bonus
  preserved); water target imported when >0 and not pre-existing; 0/existing water
  skipped; idempotent re-import; empty range → zeros + no batch write calls; batched
  (one setMany + one setTargetMany, not per-day); auth/upstream error mapping.
