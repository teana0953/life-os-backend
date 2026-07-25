# Tasks

## 1. Client: fetchDietMenus (TDD)
- [ ] Domain `ChaodaysClient`: add `fetchDietMenus(session, from, to): Promise<{ session; menus: ChaodaysDietMenu[] }>`; add `ChaodaysDietMenu { date; staple; meat; fruit; veg; waterTargetMl }`.
- [ ] `HttpChaodaysClient.fetchDietMenus`: GET `users/diet_menus?start_date&end_date`; map raw `{ date, staple, meat, fruit, veg, water, ... }` → drop oil/sugar/content/sum_*, `waterTargetMl = raw.water ?? 0`, portions `?? 0`. Non-JSON/non-array/malformed → `ChaodaysUpstreamError` (→ 502), same as siblings.

## 2. Repos: batch methods (TDD)
- [ ] `DailyTargetRepository.setMany(rows: SetDailyTargetInput[]): Promise<void>`; DrizzleDailyTargetRepository = one `db.batch` of upserts on (user, day) mirroring `set`; empty → no-op.
- [ ] `WaterRepository.listTargetRange(userId, from, to): Promise<WaterTarget[]>` (one SELECT) + `setTargetMany(rows: SetWaterTargetInput[]): Promise<void>` (one `db.batch` of upserts on (user, day); empty → no-op). DrizzleWaterRepository.
- [ ] In-memory fakes for both repos implement the new methods.

## 3. Use case importChaodaysDietTarget (TDD)
- [ ] `application/import-chaodays-diet-target.ts`: sign in; `fetchDietMenus`; read `dailyTargetRepository.listInRange` + `waterRepository.listTargetRange` once each → per-day sets. For each menu day: if the menu has at least one non-zero portion (staple/meat/fruit/veg > 0) AND no daily target exists → collect a `SetDailyTargetInput` (base* from menu, no bonus); an all-zero-portion menu is NOT written (it would clobber the carry-forward standing target and block a later real import) and counts as skipped; if no water target AND `waterTargetMl > 0` → collect a `SetWaterTargetInput`. Persist via one `setMany` + one `setTargetMany`. Return `{ portionTargetsImported, portionTargetsSkipped, waterTargetsImported, waterTargetsSkipped, from, to }`.
- [ ] Tests (in-memory repos): imported per day; existing daily target skipped (bonus preserved); an all-zero-portion menu writes NO daily target (counts skipped); water imported when >0 & absent, skipped when present or 0; idempotent re-import; empty range → zeros + zero batch write calls; batched (one setMany + one setTargetMany).

## 4. Route + wiring
- [ ] `adapters/http/routes/import-chaodays.ts`: add `createImportChaodaysDietTargetHandler({ userRepository, dailyTargetRepository, waterRepository, chaodaysClient })` validating uid/password/start_date/end_date (from ≤ to), mapping errors like siblings.
- [ ] Register `POST /api/import/chaodays/diet-target` in `app.ts`; wire options from `src/index.ts`.
- [ ] Route test: 200 summary on success; 400 on bad input / wrong creds; 502 on upstream failure (inject fakes).

## 5. Gate
- [ ] `npm test` + `npm run typecheck` green.
