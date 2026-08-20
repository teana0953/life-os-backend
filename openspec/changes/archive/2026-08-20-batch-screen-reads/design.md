## Context

Issue #114 measured the deployed backend end to end. After #112 (Smart Placement) and #113 (`Access-Control-Max-Age`), the Worker's own work is negligible — `wallTime` averages 8ms with `remote-SIN` placement — and what is left is entirely per-**request** cost:

| cost | size | source |
| --- | --- | --- |
| client → Worker network | ~478ms | client-observed 487ms minus 8ms Worker time, n=359 |
| first request after idle | +0.76s–1.08s | burst probes, both time windows |
| time-of-day tail | 7.14% of requests >2s in 15:00–17:00 UTC vs 0.48% elsewhere | 956 pooled samples |

Every one of these is paid once per HTTP request and is indifferent to how much work the request does. The health screen makes 15 requests on load, home makes 7, and because each request is an independent draw from the tail distribution, ≥1 request over 2s is **67%** (health) and **40%** (home) in the bad window.

The screens' request lists, read from the code rather than estimated:

- **`HealthScaffold._load`** issues 13 controller loads which produce 15 requests: `/api/weight-goal`, `/api/vitals/range`, `/api/health-calendar`, `/api/meals`, `/api/daily-target` (inside `TodayController`), `/api/food-items/favorites`, `/api/daily-target` again (`DailyTargetController` — the duplicate #114 names), `/api/water`, `/api/bowel`, `/api/vitals`, `/api/exercise/activities`, `/api/exercise`, `/api/menstrual`, `/api/care/today`, `/api/care/range`.
- **`HomeDashboardController._runArm`** issues 7: `/api/weight-goal`, `/api/vitals/range` (365-day lookback), `/api/menstrual`, `/api/finance/budgets`, `/api/finance/networth`, `/api/split/balances`, `/api/daily-target`.

The constraint that shapes the whole design: **both screens already tolerate partial failure and depend on it.** Each health controller swallows its own error and empties one card; `HomeDashboardController` models every arm as an `ArmSlot` precisely because an incident taught it that a failed arm rendered as "no data" is a lie. A batch endpoint that `500`s when one section fails would take that away and make the page worse than the 15-request version it replaces.

## Goals / Non-Goals

**Goals:**

- One Worker invocation per screen load, so the ~478ms, the idle-wake penalty, and the tail exposure are paid once instead of 7–15 times.
- Per-section error isolation, specified as the endpoint's contract rather than as a later refinement.
- Section payloads identical to the granular endpoints', produced by the same application use cases, so the two paths cannot drift.
- Zero change to existing endpoints, repositories, use cases, domain types, or the database.

**Non-Goals:**

- Frontend adoption. Backend repo only.
- Fixing the duplicate `/api/daily-target` fetch or the finance installment fan-out — both are client call-site bugs, unaffected either way by this change.
- A finance batch endpoint (5 requests; not worth a third endpoint yet).
- Caching, ETags, or conditional requests. This change removes request *count*; caching is a separate axis and would need its own invalidation story.
- Reducing the number of SQL queries. The same queries run; only the HTTP requests collapse.

## Decisions

### D1 — The aggregation lives in the HTTP adapter, not in a new bounded context

`src/adapters/http/routes/health-overview.ts` and `home-summary.ts` compose the existing application use cases directly, exactly as the granular route handlers do.

*Alternative considered: a `screens` bounded context with its own use cases.* Rejected — a context whose job is "what the health screen renders" would have to depend on `health`, `finance`, `split`, `notifications`, and `user`, pointing dependencies sideways across five contexts to serve a UI grouping. The grouping is a presentation fact, not a domain fact. `app.ts` is already the single place that holds every repository, so the adapter is where cross-context composition legitimately happens.

*Alternative considered: an internal `fetch` fan-out to the granular routes.* Rejected — each internal request would be a subrequest with its own auth verification, and it would reintroduce the per-request cost the change exists to remove.

### D2 — Isolation is implemented by wrapping each section, not by `try`/`catch` around the fan-out

A single helper builds an envelope from a thunk:

```ts
type Section<T> = { ok: true; data: T } | { ok: false; error: "unavailable" };

async function section<T>(run: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (err) {
    logInternalError(err);
    return { ok: false, error: "unavailable" };
  }
}
```

Because the catch is *inside*, every section promise resolves and `Promise.all` over them cannot reject. `Promise.allSettled` would work too, but it returns a positional array that must be re-keyed by index — and an index-to-key mapping that silently shifts when a section is added is exactly the kind of quiet mis-assignment this endpoint must not have. Keying an object of `key → Promise<Section>` keeps the mapping structural.

`logInternalError` is the app-boundary's existing logging path. It is called deliberately: isolation without logging converts every section fault into silence, which is how #98–#100 stayed invisible for weeks.

### D3 — `resolveUserId` runs once, before the fan-out; its failure is request-level

Every section needs the internal user id, which is itself a DB read. Resolving it inside each section would add 13 redundant reads and 13 identical failures. It runs once; if it throws, the request fails as a whole through the existing `onError` boundary.

Auth failure (`401`) and parameter validation failure (`400`) are likewise **request**-level, not section-level. Reporting a malformed `day` as fourteen `{"ok": false}` sections would hide a client bug behind a screen that merely looks broken.

### D4 — `day` is required, with no server-UTC fallback

`GET /api/health-calendar` accepts `today` and falls back to the server's UTC date. That fallback exists for compatibility with an already-shipped client; it is not a pattern to copy. These endpoints are new, so there is no client to be compatible with, and a wrong day here is wrong for the *entire screen at once* — for a UTC+8 user, for eight hours of every day. `day` required, `400` when absent or malformed.

Derived, all via UTC arithmetic so a DST boundary cannot shift a window by a day:

| endpoint | parameter | default | derives |
| --- | --- | --- | --- |
| `/api/health-overview` | `day` (required) | — | day-scoped sections; `month` and `today` for the calendar; the end of both windows |
| | `trend_days` | 30 | `vitals_trend` = `[day − 29, day]` |
| | `care_days` | 30 | `care_range` = `[day − 29, day]` |
| `/api/home-summary` | `day` (required) | — | `daily_target`; `month` for `budgets` and `net_worth`; the end of the trend window |
| | `trend_days` | 366 | `vitals_trend` = `[day − 365, day]` |

The two defaults differ on purpose and the difference is load-bearing: `TrendController.spanDays` is 30 (a chart of the last month), while `HomeDashboardController` looks back a year to find the *most recent* blood-pressure sample. A single shared default would either shorten the home lookback (blanking the tile for anyone who has not measured in a month) or make the health chart fetch a year of rows to draw thirty days.

Both window parameters clamp to `1..366`, matching `MAX_RANGE_DAYS` already enforced by `/api/vitals/range` and `/api/care/range`.

### D5 — One error code, `"unavailable"`

*Alternative considered: propagating a per-section status code or error class.* Rejected for now — the clients' per-card behaviour is binary (paint the figure, or mark the card not-refreshed), so a richer vocabulary would be fields nobody reads that still have to be kept honest. The spec pins the field as a short stable code with no internal detail, so a second code can be added later without a shape change.

Consequence accepted: a `BadRequestError` thrown *inside* a section would also surface as `"unavailable"`. Since every parameter is validated before the fan-out, a section-level `BadRequestError` would be a server bug, and `"unavailable"` is the right thing to tell a client about a server bug.

### D6 — Sections fan out concurrently, and the concurrency has real ceilings

Sections start together (`Promise.all` over the envelope promises) rather than serially. Two platform facts bound what that buys, and both are recorded here because a fake DB client will not reproduce either:

- **`neon-http` issues one HTTP request per query, with no pooling** (already noted in `wrangler.toml`). Section count is a lower bound on query count, not the query count: `daily_target` reads the target *and* the day's meals, `health_calendar` reads three repositories.
- **Workers caps simultaneous outbound connections**, and the Free plan caps **subrequests per request**. Excess `fetch` calls queue rather than fail — so the practical effect of the connection cap is that 14 sections resolve in a few waves of ~8ms rather than one, which is still one round trip's worth of latency instead of fifteen. The subrequest cap is the harder edge, and `retry-fetch.ts` retries count against it. **The implementation must count the actual queries each endpoint issues and check the number against the plan's documented ceiling** — read the current limit from Cloudflare's docs, do not infer it from a type or from this document.

**Measured against the documented ceilings (task 8.2/8.3).** Read from <https://developers.cloudflare.com/workers/platform/limits/> on **2026-08-20**: Workers **Free = 50 subrequests per invocation** (Paid = 10,000), and **6 simultaneous connections** waiting for response headers, on both plans. Counted by instrumenting the fake repositories (task 8.1), taking the worst-case branch of every carry-forward read: **`/api/health-overview` = 28 repository reads**, **`/api/home-summary` = 16**. Both counts exceed their section counts, as predicted — `daily_target` reads the target, its carry-forward, *and* the day's meals; `health_calendar` reads four; `weight_goal` reads four.

**Correction (review, this pass): the retry arithmetic above was wrong.** `retry-fetch.ts`'s `RETRY_DELAYS_MS` has three entries, so `MAX_ATTEMPTS = 4`, not 2 — a query that retries every time it can costs *four* subrequests, not two. Worst case is therefore `28 × 4 = 112`, not the 56 this section previously computed, and 112 clears the Free ceiling by more than double. All 28 reads are plain `select`s, so all 28 are retry-eligible (`isRetryableReadOnlyBody`). The scenario is not pathological: it is the *documented* 2026-08-14 12:35 incident shape (`retry-fetch.ts`'s own header comment) — "six parallel front-page reads all fail with 520" in the same 6 ms, with the first retry delay at 0 ms, so a Neon-side blip that hits mid-fan-out plausibly retries a large fraction of the 28 reads at once, not a handful.

**Action taken, not just accepted:** both batch handlers now scope their section fan-out inside `withSubrequestBudget(FREE_PLAN_SUBREQUEST_LIMIT, ...)` (`shared/db/subrequest-budget.ts`, `adapters/http/routes/screen-sections.ts`). `retry-fetch.ts` records every outbound attempt against that request-scoped budget and refuses to retry — falling straight back to the section's normal `{ ok: false, error: "unavailable" }` isolation — once the shared budget is exhausted, regardless of how many `MAX_ATTEMPTS` a given query has left. This bounds the worst case to roughly one attempt per read plus whatever concurrent retries were already in flight when the budget tipped over (a handful, not 84 extra), so an outage degrades the same way the 15-request version did — a nondeterministic subset of cards empty — instead of guaranteeing a subrequest-cap breach. The budget is `AsyncLocalStorage`-scoped per request, not a module-level counter: `index.ts`'s `getCached` reuses one `Db`/`fetchFunction` across concurrent requests sharing an isolate, so a plain counter would double-count across unrelated requests (exactly the "singleton state leaks between requests" failure mode this repo has shipped before).

Both repository-read counts are still asserted exactly in the endpoint suites, so adding a section trips a test rather than production; a `retry-fetch.test.ts` suite separately pins the shared-budget behavior (a concurrent pair of sections exhausting a small budget between them, neither retrying).

### D7 — Section payloads are produced by the same use cases and serialised the same way

Each section calls the same application function its granular handler calls and applies the same snake_case field mapping. Where a granular handler's mapping is more than a passthrough (`/api/water`, `/api/health-calendar`, `/api/daily-target`'s PUT sibling), the mapping is extracted into a shared function used by both the granular handler and the batch section, so there is one definition rather than two that agree today.

### D8 — Wiring

Both handlers take an options object assembled in `app.ts` from repositories `createApp` already receives. `health-overview` touches roughly ten of them; the option object is wide, and that width is accepted rather than hidden behind a service locator, so a missing dependency is a compile error.

### D9 — Every section is bounded by an 8-second timeout

**Decided (was an open question).** Each section runs under a per-section timeout of **8 seconds**, a single constant in `screen-sections.ts` shared by both endpoints. A section that has not settled by then resolves to `{ ok: false, error: "unavailable" }` and is logged through `logInternalError`, exactly like a thrown failure. The request still returns `200` with every key present.

The reason it is mandatory rather than deferred: today's fifteen parallel requests mean a hung query leaves *one* card empty, because the other fourteen requests have already returned. After batching, the same hang leaves the *whole screen* blank until the client's own request timeout fires. That is the failure mode this change exists to prevent, and per-section error isolation alone does not cover it — isolation handles a section that *rejects*, not one that never settles.

*Why it does not need the measurement the open question was waiting for.* The number is a backstop fuse, not a tuned budget. A tuned budget would need to know the multi-query section latency distribution — which #114 does not have, since its probes are all `/health`, a single query. A fuse only needs to sit far above anything healthy: sections run ~8ms against a Neon instance local to the Worker, so 8s is three orders of magnitude of headroom. Anything reaching it is a fault, not slow work, and no plausible measurement would move it. Choosing a generous ceiling now is strictly better than shipping no ceiling while waiting for data that would not change it.

*Alternative considered: one whole-request timeout instead of per-section.* Rejected — a request-level fuse produces a request-level failure, which is precisely the "one section kills the page" outcome D2 exists to prevent. Per-section keeps the failure inside the envelope.

*Alternative considered: `AbortSignal` propagated into the query.* Not required. `neon-http` work that outlives the fuse is abandoned, not cancelled; the section's envelope is already resolved and the late result is discarded. Cancellation would save Worker-side work, not correctness, and adds plumbing through every use case.

**Test hazard, recorded because it makes the guard silently useless:** a fake repository that resolves immediately — or any zero-delay fake — makes the timeout branch unreachable, so the test passes whether or not the timeout exists. The timeout test must use a fake that **never settles**, and must be mutation-checked: delete the timeout and the test must go red.

## Risks / Trade-offs

- **Subrequest ceiling exceeded on the Free plan** → without a mitigation, a Neon-side blip mid-fan-out could push retries past the cap and degrade a large fraction of the screen in one shot. Mitigation: D6's request-scoped subrequest budget (`shared/db/subrequest-budget.ts`) makes `retry-fetch.ts` give up on a retry once the shared budget is exhausted, plus the counting task's exact-count test so adding a section trips the assertion rather than production.
- **A slow section holds up the whole response.** Fifteen parallel requests today return fourteen fast cards while one hangs; one batch request returns nothing until the slowest section settles. Mitigation: D9's mandatory 8-second per-section timeout, which converts a hang into an ordinary `{ ok: false, error: "unavailable" }` section and bounds the whole response at 8s. The frontend keeps the granular endpoints for retries either way.
- **Isolation hides failures.** A section that fails every time returns `200` forever. Mitigation: D2's mandatory `logInternalError`, plus `[observability]` retention already enabled in `wrangler.toml`.
- **Payload drift between batch and granular.** Mitigation: D7's shared serialisation plus the spec's equality scenarios, which compare the two responses against the same data rather than against a hand-written fixture.
- **Tests that cannot fail.** A fake repository that never throws proves nothing about isolation. Mitigation: the failure tests must use a repository that actually rejects, and must assert the *other* sections' contents — an assertion only on `status === 200` passes even if the handler returns an empty object.
- **Larger single response.** Fourteen sections in one body is more bytes than any single response today, but strictly fewer than the fifteen bodies plus fifteen sets of headers it replaces.
- **Smart Placement is a heuristic.** 27–40% of requests still executed locally in #114's runs, and this change does nothing about that. The win is in request *count*, which holds under either placement.

## Migration Plan

Purely additive: two new routes, no schema change, no change to existing responses. Deploy is a normal `wrangler deploy`. Nothing consumes the endpoints until a separate frontend change adopts them, so rollback is deleting the routes; there is no data to migrate and no client to strand.

Verification after deploy, mirroring #114's method rather than asserting the outcome: drive the real app's health screen with `wrangler tail --format json` and confirm request count, then compare `time_starttransfer − time_connect` for one `/api/health-overview` against the sum of the fifteen granular requests. Note that `cf.colo` is the ingress colo — only `cf-placement` shows where the Worker ran.

## Open Questions

- **Is `favorite_food_items` a screen section at all?** `DictionaryController.load()` is not day-scoped and feeds the food picker rather than a card. It is included because it is one of the 15 measured requests, but it is the one section a reviewer might reasonably cut.
- **Whether the OPTIONS preflight per screen also collapses to one.** #113 shipped `Access-Control-Max-Age: 7200` but the resulting OPTIONS:GET ratio has not been re-measured (#114 lists this as unverified), so the preflight saving from batching is unquantified.
