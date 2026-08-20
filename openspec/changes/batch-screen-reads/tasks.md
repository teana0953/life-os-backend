## 1. Section envelope and shared helpers

- [ ] 1.1 Add `src/adapters/http/routes/screen-sections.ts` exporting the `Section<T>` type (`{ ok: true; data: T } | { ok: false; error: "unavailable" }`) and the `section(run)` helper that resolves to an envelope, catching inside so the promise never rejects, and calling `logInternalError` on the caught error (design D2).
- [ ] 1.2 In the same file, add the UTC-based date helpers the endpoints derive their parameters with: `monthOf(day)` → `YYYY-MM`, and `windowEndingAt(day, days)` → `{ from, to }` inclusive with `from = day − (days − 1)` (design D4).
- [ ] 1.3 Add `src/adapters/http/validation.ts` support for the optional window parameter — an `optionalDayCount(value, field, fallback)` built on the existing `requireNumberInRange` with bounds `1..366`, matching the `MAX_RANGE_DAYS` already enforced by `/api/vitals/range` and `/api/care/range`.
- [ ] 1.4 Add `test/adapters/http/screen-sections.test.ts` covering: a resolving thunk yields `{ ok: true, data }`; a rejecting thunk yields `{ ok: false, error: "unavailable" }` and never rejects; the rejected error's message text does not appear anywhere in the envelope; `logInternalError` is called for a failure and not for a success; `windowEndingAt` is inclusive at both ends and does not drift across a DST boundary.

- [ ] 1.5 In the same file, add the per-section timeout constant `SECTION_TIMEOUT_MS = 8_000` (a single constant shared by both endpoints) and apply it **inside** `section(run)`, so every section on both endpoints is bounded without each call site opting in (design D9). A section still pending when the fuse fires resolves to `{ ok: false, error: "unavailable" }` and calls `logInternalError`, identically to a thrown failure. Clear the timer when the thunk settles first, so a fast section leaves no pending timer behind.
- [ ] 1.6 Confirm the timeout changes nothing at request level: `section` still never rejects, so `Promise.all` over the envelopes cannot reject and the handler still returns `200` with every key present.

## 2. Reusable serialisation for the sections

- [ ] 2.1 For each granular handler whose response is more than a passthrough of the use-case result, extract the object-building step into an exported `…ToJson` function in that route file, leaving the handler calling it — `water.ts`, `bowel.ts`, `vitals.ts`, `exercise.ts`, `menstrual.ts`, `body-profile.ts` (weight goal), `health-calendar.ts`, `daily-target.ts`, `meals.ts`, `food-dictionary.ts` (favorites), `care.ts` (today and range), `finance.ts` (budgets, net worth), `split.ts` (balances) (design D7).
- [ ] 2.2 Verify the extraction changed no response: run the existing route test files for every file touched in 2.1 and confirm they pass unchanged (no test edits in this task — an edited assertion would hide exactly the drift this step must not introduce).

## 3. `GET /api/health-overview`

- [ ] 3.1 Add `src/adapters/http/routes/health-overview.ts` with `createGetHealthOverviewHandler(options)`: resolve the user id once via `resolveUserId`, validate `day` with `requireDay` and `trend_days` / `care_days` with `optionalDayCount` (default 30) **before** any fan-out, then build the fourteen sections concurrently and `c.json` the result (design D3, D4).
- [ ] 3.2 Wire the fourteen sections to the same application use cases the granular handlers call, with the derived parameters: `weight_goal`, `vitals_trend` (window from `trend_days`), `health_calendar` (`monthOf(day)` + `day` as `today`), `meals` (day), `daily_target` (day), `favorite_food_items`, `water` (day), `bowel` (day), `vitals` (day), `exercise_activities`, `exercise` (day), `menstrual`, `care_today`, `care_range` (window from `care_days`).
- [ ] 3.3 Register `app.get("/api/health-overview", authMiddleware, …)` in `src/adapters/http/app.ts` and assemble its options object from the repositories `createApp` already receives (design D8).

## 4. `GET /api/home-summary`

- [ ] 4.1 Add `src/adapters/http/routes/home-summary.ts` with `createGetHomeSummaryHandler(options)` following the same shape: user id once, `day` required, `trend_days` optional defaulting to **366**, validation before fan-out.
- [ ] 4.2 Wire the seven sections: `weight_goal`, `vitals_trend` (year-long window by default), `menstrual`, `budgets` (`monthOf(day)`), `net_worth` (`monthOf(day)`), `split_balances`, `daily_target` (day).
- [ ] 4.3 Register `app.get("/api/home-summary", authMiddleware, …)` in `src/adapters/http/app.ts` with its options object.

## 5. Tests — happy path and parameters

- [ ] 5.1 Add `test/adapters/http/health-overview.test.ts`: an authenticated request with a valid `day` responds `200` and the body contains **all fourteen** keys, each `{ ok: true, data }`. Assert each key by name rather than by count, so a renamed section fails.
- [ ] 5.2 Assert the default windows: no `trend_days` / `care_days` → both windows are `[day − 29, day]` inclusive; explicit values are honoured. Verify by asserting the arguments the fake repositories were called with, not only the returned body.
- [ ] 5.3 Assert `health_calendar` receives `monthOf(day)` and `day` as its `today`, and that the day-scoped sections receive exactly `day`.
- [ ] 5.4 Add `test/adapters/http/home-summary.test.ts` with the equivalent coverage: all seven keys; `budgets` and `net_worth` receive `monthOf(day)`; the trend window defaults to `[day − 365, day]`.
- [ ] 5.5 Request-level fault tests for both endpoints: missing `day` → `400` with no section object in the body; malformed `day` → `400`; `trend_days=400` and `trend_days=0` → `400`; missing/invalid bearer token → `401` with no section object.

## 6. Tests — error isolation (the contract)

- [ ] 6.1 One section fails: a repository that actually **rejects** (not a fake returning empty) makes `bowel` `{ ok: false, error: "unavailable" }` while every other section is asserted to still carry its expected `data`. Assert the surviving sections' contents, not just the status code — a status-only assertion passes against an empty body.
- [ ] 6.2 Every section fails: response is still `200` and every key is `{ ok: false, error: "unavailable" }`.
- [ ] 6.3 A failing section whose error message contains a connection string / stack-trace-shaped text: assert that text appears nowhere in the serialised response body.
- [ ] 6.4 A failing section is logged: assert `logInternalError`'s console path is invoked once per failed section.
- [ ] 6.5 Sections do not cancel one another: one section rejects immediately while others are still pending; assert the pending ones ran to completion and reported their own outcomes.
- [ ] 6.6 Mutation-check the isolation guards: make the handler `500` on any section failure and confirm 6.1/6.2 fail; make it omit a failed key and confirm 6.1 fails; make it return `{ ok: true, data: null }` for a failed section and confirm 6.1 fails. A guard that survives all three is not testing isolation.

- [ ] 6.7 Per-section timeout, unit level, in `test/adapters/http/screen-sections.test.ts`: a thunk that **never settles** yields `{ ok: false, error: "unavailable" }` once the fuse elapses, and `logInternalError` is called for it. **TEST HAZARD — read before writing this test:** a fake repository that resolves immediately, or any zero-delay fake, makes the timeout branch unreachable and the guard permanently green regardless of whether the timeout exists. The fake here MUST be a promise that never resolves and never rejects (`new Promise(() => {})`), not a delayed or empty one. Drive the clock with fake timers rather than waiting 8 real seconds.
- [ ] 6.8 Per-section timeout, endpoint level: `GET /api/health-overview` with one repository whose call never settles responds `200`, that section is `{ ok: false, error: "unavailable" }`, **every** section key is still present, and the other sections still carry their expected `data` (assert their contents — a status-only assertion passes against an empty body).
- [ ] 6.9 Mutation-check the timeout guard, since a guard that cannot fail is worse than none: delete the timeout from `section` (let the hung section hang) and confirm 6.7 **and** 6.8 go red — a hang, not a pass. Then re-check the inverse: replace the never-settling fake with an immediately-resolving one and confirm the timeout test goes green *even with the timeout deleted*, proving the fake — not the timeout — is what the test would otherwise be measuring. Restore both afterwards and record the observed failure lines.

## 7. Tests — payload equality and non-regression

- [ ] 7.1 For a representative day-scoped section (`water`) and a windowed one (`vitals_trend`), assert the batch section's `data` deep-equals the body of the corresponding granular endpoint fetched from the same app instance with the parameters the batch endpoint derives.
- [ ] 7.2 Assert every section key is present on every `200` response regardless of outcome, and that no section is `null`.
- [ ] 7.3 Assert the granular endpoints still answer unchanged after registration — extend `test/adapters/http/app.test.ts` route coverage rather than duplicating the per-route suites.

## 8. Platform-limit verification (design D6)

- [ ] 8.1 Count the SQL queries each endpoint issues in the worst case by instrumenting the fake repositories in the tests and asserting the totals for `/api/health-overview` and `/api/home-summary`. Remember the count exceeds the section count: `daily_target` reads target **and** meals, `health_calendar` reads three repositories.
- [ ] 8.2 Read Cloudflare's current documented per-request subrequest limit for the plan this Worker runs on (Free) and the simultaneous-connection cap — from the docs, not inferred from a type or from `design.md` — and record both numbers with the retrieval date in `design.md` §D6.
- [ ] 8.3 If the worst-case count from 8.1 is close to or over the ceiling from 8.2, stop and revise the section list before continuing; otherwise keep the assertion from 8.1 in the test suite so adding a section later trips the test rather than production. `retry-fetch.ts` retries count toward the ceiling — include them in the worst case.

## 9. Verification and close-out

- [ ] 9.1 `npm test` green, typecheck clean, lint clean.
- [ ] 9.2 `npx openspec validate batch-screen-reads --strict` passes.
- [ ] 9.3 After deploy, re-run #114's method on the real app: `wrangler tail --format json` while loading the health screen to confirm the request count, and a `curl -w` sample of `/api/health-overview` compared against the sum of the fifteen granular requests. Read placement from `cf-placement`, not `cf.colo`.
