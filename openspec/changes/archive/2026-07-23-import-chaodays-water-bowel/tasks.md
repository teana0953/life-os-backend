# Tasks

## 1. Domain: client port + water/bowel types
- [ ] `domain/chaodays-client.ts`: `ChaodaysWaterRecord {date, waterMl, recordedAt}`,
      `ChaodaysDefecationRecord {date, count, isAbnormality, note}`, and
      `fetchWaterRecords` / `fetchDefecationRecords` on the port.

## 2. Adapter: HttpChaodaysClient fetches (TDD, injected fetch)
- [ ] Tests: both fetches send the 3 headers, parse the `{data:[...]}` envelope
      (`water`→waterMl, `recorded_at`→recordedAt; `defecation`→count,
      `is_abnormality`→isAbnormality, `note`), rotate the session; non-JSON /
      non-array / malformed → `ChaodaysUpstreamError`.
- [ ] Implement both in `adapters/http-chaodays-client.ts`.

## 3. Use case: importChaodaysWater (TDD)
- [ ] Test (`InMemoryWaterRepository` additive + `FakeChaodaysClient`): sums a day's
      entries; a day with existing intake is skipped; **a day summing to 0 is not
      written**; empty range → 0/0; summary counts; auth propagates; params thread.
- [ ] `application/import-chaodays-water.ts` (sum per day; write only if sum > 0 and
      getIntake == null).

## 4. Use case: importChaodaysBowel (TDD)
- [ ] Test (`InMemoryBowelRepository` + fake): count summed; **isNormal = !any
      abnormal**; notes joined; a day with an existing bowel log is skipped; summary;
      auth propagates.
- [ ] `application/import-chaodays-bowel.ts` (aggregate; skip if get != null).

## 5. Routes + wiring (TDD, integration)
- [ ] Route tests via `createApp`: `POST /api/import/chaodays/water` and `.../bowel`
      — 200 summary; 401; 400 (missing/bad dates); 400 `chaodays_auth_failed`; 502
      `chaodays_unavailable`.
- [ ] Two handlers in `routes/import-chaodays.ts`; register in `app.ts`; wiring.

## 6. Gate
- [ ] `npm test` + `npm run typecheck` green.
