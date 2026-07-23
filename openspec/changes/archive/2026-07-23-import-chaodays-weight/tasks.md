# Tasks

## 1. Domain: chaodays client port + errors
- [ ] `domain/chaodays-client.ts`: `ChaodaysSession {accessToken, client, uid}`,
      `ChaodaysWeightRecord {date, weight, bodyFatPct|null}`, `ChaodaysClient`
      port (`signIn`, `fetchWeightRecords` → `{session, records}`), and
      `ChaodaysAuthError` / `ChaodaysUpstreamError` classes with fixed, generic
      messages (never embedding the password/token).

## 2. Use case: importChaodaysWeight (TDD)
- [ ] Test with `InMemoryVitalsRepository` + `FakeChaodaysClient`: writes weight/
      bodyFat; read-modify-write preserves existing bp/glucose/spo2; **a null
      chaodays body_fat_pct does not erase an existing bodyFatPct**; skips records
      with no weight; counts imported/skipped; propagates `ChaodaysAuthError`.
- [ ] `application/import-chaodays-weight.ts` making the test pass
      (`bodyFatPct: record.bodyFatPct ?? existing?.bodyFatPct ?? null`).

## 3. Adapter: HttpChaodaysClient (TDD, injected fetch)
- [ ] Test (inject a fake `fetch`): `signIn` posts `{user:{uid,password}}`, reads
      `access-token`/`client`/`uid` headers → session; 401 → `ChaodaysAuthError`;
      other non-200 → `ChaodaysUpstreamError`. `fetchWeightRecords` sends the 3
      headers, parses the `{data:[...]}` envelope, and returns the rotated session
      from the response headers.
- [ ] `adapters/http-chaodays-client.ts` making it pass (base URL constant).

## 4. Route + error mapping (TDD, integration)
- [ ] Route test via `createApp`: 200 summary; 401 without lifeos token; 400 on
      missing fields / bad dates; 400 `chaodays_auth_failed`; 502
      `chaodays_unavailable`.
- [ ] `routes/import-chaodays.ts`: `POST /api/import/chaodays/weight` (snake_case
      body, `resolveUserId`, `BadRequestError` validation) calling the use case.
- [ ] `app.ts` onError: map `ChaodaysAuthError`→400 `chaodays_auth_failed`,
      `ChaodaysUpstreamError`→502 `chaodays_unavailable`. Wire the client +
      route in `createApp` / `index.ts` (`CreateAppOptions`).

## 5. Gate
- [ ] `npm test` + `npm run typecheck` green.
