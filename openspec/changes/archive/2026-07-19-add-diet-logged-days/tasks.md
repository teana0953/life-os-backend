# Tasks — Logged days in a month

## 1. Validator
- [ ] 1.1 Add `requireMonth(value, field="month")` to `validation.ts`: requires a
      string matching `^\d{4}-(0[1-9]|1[0-2])$`, else `BadRequestError`.

## 2. Port + use case (TDD)
- [ ] 2.1 Add `listLoggedDays(userId, month): Promise<string[]>` to the
      `DietLogRepository` port.
- [ ] 2.2 Write failing tests (extend the in-memory diet-log fake with
      `listLoggedDays`): distinct days, ascending, other months excluded, empty
      month → `[]`, owner isolation, a Feb month works.
- [ ] 2.3 Add `getLoggedDays(repo, userId, month)` use case; make tests green.

## 3. Drizzle adapter
- [ ] 3.1 Implement `listLoggedDays`: `selectDistinct(day)` where
      `userId AND day >= '<month>-01' AND day < ('<month>-01')::date + interval '1 month'`,
      order by day asc. Do NOT use a `-31` upper bound (invalid Feb date).

## 4. HTTP route
- [ ] 4.1 Add `createGetLoggedDaysHandler` (validate `month`, respond `{ days }`)
      and wire `GET /api/diet-entries/logged-days` in `app.ts`.
- [ ] 4.2 Route tests: happy path `{ days }`; malformed/missing month → 400;
      `logged-days` not captured by `:id`; no auth → 401.

## 5. Verify
- [ ] 5.1 `npm test` + `npm run typecheck` green; no change to
      create/delete/update/day-view, daily-target, or schema.
