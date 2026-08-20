## ADDED Requirements

### Requirement: Health screen batch read endpoint

The system SHALL expose a protected `GET /api/health-overview?day=YYYY-MM-DD` that returns, in one response, every section the health screen loads: `weight_goal`, `vitals_trend`, `health_calendar`, `meals`, `daily_target`, `favorite_food_items`, `water`, `bowel`, `vitals`, `exercise_activities`, `exercise`, `menstrual`, `care_today`, and `care_range`.

`day` SHALL be required and SHALL be the caller's local calendar day. The system SHALL NOT fall back to the server's UTC day: a UTC+8 caller and the server disagree about "today" for eight hours of every day, and a batch endpoint that guesses would put the whole screen on the wrong day at once.

`day` SHALL drive the day-scoped sections (`meals`, `daily_target`, `water`, `bowel`, `vitals`, `exercise`), SHALL supply both the month and the `today` reference for `health_calendar`, and SHALL be the inclusive end of the `vitals_trend` and `care_range` windows.

The system SHALL accept two optional window parameters, `trend_days` and `care_days`, each defaulting to `30` and each constrained to `1..366`. The corresponding window SHALL be `[day − (n − 1), day]` inclusive, computed via UTC so a DST boundary cannot shift it by a day.

#### Scenario: Every section returned for a valid day

- **WHEN** an authenticated client sends `GET /api/health-overview?day=2026-08-20` and every section succeeds
- **THEN** the system responds `200` with a JSON object carrying all fourteen section keys, each holding `{ "ok": true, "data": … }`

#### Scenario: Window parameters default to 30 days

- **WHEN** an authenticated client sends `GET /api/health-overview?day=2026-08-20` without `trend_days` or `care_days`
- **THEN** `vitals_trend` covers `2026-07-22`–`2026-08-20` inclusive and `care_range` covers the same window

#### Scenario: Window parameters honoured when given

- **WHEN** an authenticated client sends `GET /api/health-overview?day=2026-08-20&trend_days=7&care_days=90`
- **THEN** `vitals_trend` covers `2026-08-14`–`2026-08-20` inclusive and `care_range` covers `2026-05-23`–`2026-08-20` inclusive

#### Scenario: Missing day is a request-level fault

- **WHEN** an authenticated client sends `GET /api/health-overview` with no `day`
- **THEN** the system responds `400` with `{ "error": "bad_request", … }` and no section object

#### Scenario: Malformed day is a request-level fault

- **WHEN** an authenticated client sends `GET /api/health-overview?day=20-08-2026`
- **THEN** the system responds `400` with `{ "error": "bad_request", … }`

#### Scenario: Out-of-range window is a request-level fault

- **WHEN** an authenticated client sends `GET /api/health-overview?day=2026-08-20&trend_days=400`
- **THEN** the system responds `400` with `{ "error": "bad_request", … }`

#### Scenario: Unauthenticated request is rejected whole

- **WHEN** a client sends `GET /api/health-overview?day=2026-08-20` without a valid bearer token
- **THEN** the system responds `401` and no section object

### Requirement: Home screen batch read endpoint

The system SHALL expose a protected `GET /api/home-summary?day=YYYY-MM-DD` that returns, in one response, every section the home dashboard loads: `weight_goal`, `vitals_trend`, `menstrual`, `budgets`, `net_worth`, `split_balances`, and `daily_target`.

`day` SHALL be required and SHALL be the caller's local calendar day, with no server-UTC fallback, for the same reason as the health endpoint. `day` SHALL drive `daily_target`, SHALL supply the `YYYY-MM` month for `budgets` and `net_worth`, and SHALL be the inclusive end of the `vitals_trend` window.

The system SHALL accept an optional `trend_days` parameter defaulting to `366` and constrained to `1..366`, giving a `[day − (n − 1), day]` inclusive window — the home dashboard reads only the most recent blood-pressure sample from it, so its default lookback is a year rather than the health screen's month.

#### Scenario: Every section returned for a valid day

- **WHEN** an authenticated client sends `GET /api/home-summary?day=2026-08-20` and every section succeeds
- **THEN** the system responds `200` with a JSON object carrying all seven section keys, each holding `{ "ok": true, "data": … }`

#### Scenario: Month-scoped sections derive their month from day

- **WHEN** an authenticated client sends `GET /api/home-summary?day=2026-08-20`
- **THEN** `budgets` and `net_worth` are computed for month `2026-08`

#### Scenario: Trend window defaults to a year

- **WHEN** an authenticated client sends `GET /api/home-summary?day=2026-08-20` without `trend_days`
- **THEN** `vitals_trend` covers `2025-08-20`–`2026-08-20` inclusive

#### Scenario: Missing day is a request-level fault

- **WHEN** an authenticated client sends `GET /api/home-summary` with no `day`
- **THEN** the system responds `400` with `{ "error": "bad_request", … }` and no section object

#### Scenario: Unauthenticated request is rejected whole

- **WHEN** a client sends `GET /api/home-summary?day=2026-08-20` without a valid bearer token
- **THEN** the system responds `401` and no section object

### Requirement: Per-section error isolation

Each section of a batch response SHALL be a self-describing envelope: `{ "ok": true, "data": <payload> }` on success, or `{ "ok": false, "error": <code> }` on failure. A batch endpoint SHALL respond `200` whenever the caller is authenticated and the request parameters are valid, **regardless of how many sections failed** — including when every section failed.

A failing section SHALL NOT prevent, cancel, or alter any other section: the sections SHALL be evaluated so that each one's outcome is recorded independently.

`error` SHALL be a short, stable, machine-readable code and SHALL NOT contain stack traces, driver messages, connection strings, or any other internal detail. The only code emitted by this change is `"unavailable"`. A failed section SHALL still be logged server-side through the existing internal-error logging path, so that isolation does not turn a real fault into silence.

This is the reason the endpoints exist in this shape rather than a simpler one: today each health-screen controller and each home-dashboard arm swallows its own error, so one broken query empties one card. A batch endpoint that `500`s on one section failure would turn that into "the whole page failed" — strictly worse than the fifteen-request status quo it replaces.

#### Scenario: One section fails, the rest are returned

- **WHEN** an authenticated client sends `GET /api/health-overview?day=2026-08-20` and the bowel query throws
- **THEN** the system responds `200`, `bowel` is `{ "ok": false, "error": "unavailable" }`, and every other section is `{ "ok": true, "data": … }`

#### Scenario: Every section fails

- **WHEN** an authenticated client sends `GET /api/home-summary?day=2026-08-20` and every underlying query throws
- **THEN** the system responds `200` and all seven sections are `{ "ok": false, "error": "unavailable" }`

#### Scenario: A section error carries no internal detail

- **WHEN** a section fails with an error whose message contains a connection string or stack trace
- **THEN** the section is `{ "ok": false, "error": "unavailable" }` and the response body contains none of that text

#### Scenario: A failed section is still logged

- **WHEN** a section fails
- **THEN** the system logs the failure through the internal-error logging path used by the app's error boundary

#### Scenario: Sections do not cancel one another

- **WHEN** one section rejects while other sections are still in flight
- **THEN** the still-in-flight sections run to completion and report their own outcomes

### Requirement: Per-section timeout

Each section SHALL be bounded by a per-section timeout of **8 seconds**, expressed as a single constant shared by both batch endpoints. A section whose work has not settled when the timeout elapses SHALL resolve to `{ "ok": false, "error": "unavailable" }` — indistinguishable from any other section failure — and SHALL be logged through the same internal-error logging path a thrown section failure uses.

The timeout is a backstop fuse, not a tuned latency budget: it exists so that a single hung query cannot hold the response open indefinitely. It is deliberately far above any measured section latency (sections run ~8ms against a Neon instance local to the Worker), so a section reaching it means a fault, not slowness.

This requirement is load-bearing for the change's stated purpose. Today's fifteen parallel requests mean a hung query leaves **one** card empty; once the screen's reads are batched, the same hang leaves the **whole screen** blank. That is the exact failure mode this change claims to prevent, and it is the only one not otherwise covered by per-section error isolation.

Timing out a section SHALL NOT change request-level behaviour: the response SHALL still be `200` for an authenticated request with valid parameters, and SHALL still contain every section key defined for that screen. A timed-out section SHALL NOT prevent, cancel, or alter any other section.

#### Scenario: A hung section resolves as unavailable and the rest are returned

- **WHEN** an authenticated client sends `GET /api/health-overview?day=2026-08-20` and the bowel query never settles
- **THEN** after the 8-second timeout the system responds `200`, `bowel` is `{ "ok": false, "error": "unavailable" }`, and every other section is `{ "ok": true, "data": … }`

#### Scenario: A timed-out section keeps its key and the response stays 200

- **WHEN** a section times out
- **THEN** the response status is `200`, every section key defined for that screen is present, and the timed-out key holds an envelope with `ok` false rather than being omitted or `null`

#### Scenario: A timed-out section is logged

- **WHEN** a section times out
- **THEN** the system logs the failure through the internal-error logging path used for a thrown section failure

#### Scenario: A timed-out section does not cancel the others

- **WHEN** one section hangs past the timeout while other sections are still in flight
- **THEN** the other sections run to completion and report their own outcomes

#### Scenario: A section finishing under the ceiling is unaffected

- **WHEN** a section settles successfully before the 8-second ceiling
- **THEN** the section is `{ "ok": true, "data": … }` and the timeout has no observable effect on it

### Requirement: Every section key is always present

A batch response SHALL contain every section key defined for that screen on every `200` response, whether the section succeeded or failed. The system SHALL NOT omit a key to signal failure, and SHALL NOT return `null` in place of an envelope.

#### Scenario: Failed sections keep their keys

- **WHEN** a batch response is returned with some sections failed
- **THEN** every section key defined for that screen is present in the body, each holding an envelope with an `ok` field

### Requirement: Section payloads match the granular endpoints

For a given user and the parameters a batch endpoint derives, each successful section's `data` SHALL be the same JSON payload the corresponding granular endpoint returns. The batch endpoints SHALL reuse the existing application use cases rather than reimplementing any query, so that the two paths cannot drift apart in what they compute.

#### Scenario: Batch section equals granular response

- **WHEN** an authenticated client fetches `GET /api/health-overview?day=D` and `GET /api/water?day=D` against the same data
- **THEN** the `water` section's `data` equals the body of the `/api/water` response

#### Scenario: Windowed section equals granular response

- **WHEN** an authenticated client fetches `GET /api/health-overview?day=D&trend_days=N` and `GET /api/vitals/range?from=…&to=D` for the window the batch endpoint derives
- **THEN** the `vitals_trend` section's `data` equals the body of the `/api/vitals/range` response

### Requirement: Granular endpoints remain individually addressable

The existing granular read endpoints SHALL remain registered, unchanged in path, parameters, and response shape. The batch endpoints are a first-paint optimisation, not a replacement: writes, single-card retries, and refreshes continue to address one endpoint at a time.

#### Scenario: Granular endpoint still answers after the batch endpoints ship

- **WHEN** an authenticated client sends `GET /api/water?day=2026-08-20`
- **THEN** the system responds exactly as it did before this change

### Requirement: Batch endpoints are per screen and not composable by the caller

The system SHALL expose one batch endpoint per screen, each with a fixed section list determined by the endpoint. The system SHALL NOT expose a general-purpose batch endpoint, and SHALL NOT let a caller choose which sections a batch response contains — a caller-composed batch makes every screen pay for data it does not render and dissolves the per-screen contract these endpoints exist to state.

#### Scenario: Section list is fixed by the endpoint

- **WHEN** an authenticated client sends `GET /api/health-overview?day=2026-08-20` with any additional query parameter naming sections
- **THEN** the response still contains exactly the fourteen sections defined for the health screen

#### Scenario: Home and health stay separate

- **WHEN** the batch endpoints are registered
- **THEN** `/api/health-overview` and `/api/home-summary` are two distinct endpoints with their own section lists, and no endpoint serves both screens
