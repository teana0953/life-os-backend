# Tasks

## 1. Domain: glucose parsing + food cleaning (TDD, pure fns)
- [ ] Tests: `parseGlucoseReadings(name, time)` — pre/post (incl. 1hr/2hr multiple),
      fasting, mixed food+glucose, value-less skipped, full-width/half-width colon;
      `stripGlucoseText(name)` — glucose-only → "", mixed → food only, pure food → same.
- [ ] `domain/chaodays-diet-parse.ts` implementing both.

## 2. Domain: client port + diet types
- [ ] `ChaodaysClient.fetchDietRecords`, `ChaodaysDietRecord`, `ChaodaysDietItem`
      (staple/meat/fruit/veg only) in `domain/chaodays-client.ts`.

## 3. Adapter: HttpChaodaysClient.fetchDietRecords (TDD, injected fetch)
- [ ] Test: sends 3 headers, parses `{data:[{date,record_type,recorded_at,
      diet_record_items:[...]}]}`, drops oil/sugar, rotates session; non-JSON/non-array
      200 → `ChaodaysUpstreamError`.
- [ ] Implement in `adapters/http-chaodays-client.ts`.

## 4. Use case: importChaodaysDiet (TDD)
- [ ] Test with `InMemoryMealRepository` + `InMemoryVitalsRepository` +
      `FakeChaodaysClient`: meal-type mapping; only portion>0 items become meal items
      (portionless / glucose-only → no item); **multiple same-type records on a day
      merge into one meal**; **a pre-existing meal type is skipped once** (judged from a
      pre-import snapshot, not live); glucose appended preserving + dedup (incl. same-time
      1hr vs 2hr kept); summary counts; auth failure propagates; params thread.
- [ ] `application/import-chaodays-diet.ts`: per-day pre-existing meal snapshot for
      idempotency; import iff portion>0 (name nullable); RMW glucose dedup by
      (time, value, mealContext, label).

## 5. Route + wiring (TDD, integration)
- [ ] Route test via `createApp`: 200 summary; 401; 400 (missing/bad dates); 400
      `chaodays_auth_failed`; 502 `chaodays_unavailable`.
- [ ] `routes/import-chaodays.ts` (or sibling): `POST /api/import/chaodays/diet`; wire
      the use case in `app.ts` (`CreateAppOptions`, register) + `index.ts`.

## 6. Gate
- [ ] `npm test` + `npm run typecheck` green.
