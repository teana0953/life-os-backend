## Why

Issue #114 measured the backend end to end (2026-08-18/19). After #112 (Smart Placement) and #113 (CORS preflight caching) the Worker itself is fast — `wallTime` averages **8ms** — but every HTTP request still pays **~478ms of network** to reach the Worker, plus a **~1s idle-wake penalty** on the first request after a pause, plus a **time-of-day tail** (15:00–17:00 UTC: 7.14% of requests exceed 2s) that we do not control. All three are per-request costs, and the health screen makes **15 requests** on load, home **7**. Because each request is an independent draw, the tail compounds: ≥1 request over 2s is **67%** for the health screen in the bad window, **40%** for home.

Collapsing a screen's load into one Worker invocation pays the fixed cost once and reduces exposure to the tail from 15 draws to 1 (~67% → ~7% for health). The queries themselves are unchanged and cost ~8ms each because Neon is local to the Worker.

## What Changes

- **New** `GET /api/health-overview?day=YYYY-MM-DD` returning, in one response, every section the health scaffold loads today: weight goal, vitals trend range, health calendar, day meals, daily target, favorite food items, water, bowel, vitals day, exercise activities, exercise day, menstrual overview, care today, care adherence range.
- **New** `GET /api/home-summary?day=YYYY-MM-DD` returning the seven home-dashboard arms: weight goal, vitals trend range, menstrual overview, finance budgets, net worth, split balances, daily target.
- **Per-section error isolation is the core contract, not a refinement.** Each section carries `{ "ok": true, "data": … }` or `{ "ok": false, "error": … }`. The endpoint responds `200` whenever the caller is authenticated and the parameters are valid — **it never `500`s because one section failed**. A batch endpoint that collapses on one failure turns "one card is empty" into "the whole page failed", which is strictly worse than the 15-request status quo, where every controller already swallows its own error.
- The batch response bodies reuse the **exact** payload shapes of the existing granular endpoints, so a section's `data` is byte-comparable with what the granular endpoint returns for the same user, day, and window.
- Existing granular endpoints are **unchanged and stay individually addressable**. The batch is a first-paint optimisation, not a replacement — writes, single-card retries, and refreshes keep using them.
- No general-purpose "give me everything" endpoint, and no shared endpoint across screens: home and health stay separate because their payloads barely overlap and a merged endpoint would make each screen pay for data it does not render.

Out of scope (deliberately, each with a reason):

- **Frontend adoption.** Backend repo only; the Flutter client keeps its 15 requests until a separate frontend change adopts the batch.
- **The duplicate `/api/daily-target` fetch per health-screen load** and the **unbounded per-installment-plan fan-out in the finance month load**. Both are named in #114 as worth fixing, both are client-side call-site bugs, and neither is fixed or made worse by adding an endpoint.
- **A finance-screen batch endpoint.** Finance makes 5 requests; the ratio does not justify a third endpoint yet.

## Capabilities

### New Capabilities

- `screen-batch-reads`: per-screen batch read endpoints that return every section of one screen in a single Worker invocation, with per-section success/failure isolation and no general-purpose batching.

### Modified Capabilities

<!-- None. The granular endpoints' requirements are unchanged; this change only adds a new capability alongside them. -->

## Impact

- **New code**: `src/adapters/http/routes/health-overview.ts`, `src/adapters/http/routes/home-summary.ts`, and a small shared section-runner helper that turns a thrown error into `{ ok: false, error }`.
- **Modified code**: `src/adapters/http/app.ts` — two route registrations plus the handler option wiring. The wiring is wide (the health endpoint touches ~10 repositories already passed into `createApp`), but no repository, application use case, or domain type changes.
- **APIs**: two additive `GET` routes under `/api`. No breaking change; no existing response shape moves.
- **Auth/errors**: both routes sit behind the existing auth middleware. A failed token still returns `401` for the whole request, and an invalid `day` still returns `400` — those are request-level faults, not section-level ones, and isolating them would hide a client bug behind fourteen identical section errors.
- **Not affected**: database schema, migrations, cron/workflows, the assistant, push delivery.
