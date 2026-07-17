# api-platform Specification

## Purpose
TBD - created by archiving change add-walking-skeleton. Update Purpose after archive.
## Requirements
### Requirement: Health check endpoint
The system SHALL expose a public `GET /health` endpoint that reports service and database availability without requiring authentication.

#### Scenario: Service and database healthy
- **WHEN** a client sends `GET /health` and the database ping succeeds
- **THEN** the system responds `200` with JSON `{ "ok": true }`

#### Scenario: Database unreachable
- **WHEN** a client sends `GET /health` and the database ping fails
- **THEN** the system responds `503` with JSON `{ "ok": false }`

### Requirement: Uniform error responses
The system SHALL return errors as JSON with a stable shape and SHALL NOT leak internal details (stack traces, driver messages, connection strings) in any response.

#### Scenario: Unhandled internal error
- **WHEN** an unexpected error is thrown while handling any request
- **THEN** the system responds `500` with JSON `{ "error": "internal" }` and no internal details

### Requirement: Secrets kept out of source
The system SHALL read `DATABASE_URL` and `FIREBASE_PROJECT_ID` from Workers environment bindings (wrangler secrets), and the repository SHALL NOT contain any secret values.

#### Scenario: Runtime configuration
- **WHEN** the Worker handles a request that needs the database or token verification
- **THEN** it obtains `DATABASE_URL` and `FIREBASE_PROJECT_ID` from the environment bindings

### Requirement: Documented architecture conventions
The repository SHALL document the hexagonal (ports & adapters), context-first architecture conventions — layer responsibilities, dependency direction, and the template for adding a new bounded context — in a repo-level document readable by developers and AI agents.

#### Scenario: New contributor onboarding
- **WHEN** a developer or AI agent reads the repo-level architecture document
- **THEN** it states that domain defines ports, adapters implement them, dependencies point inward only, and new contexts copy the `contexts/user/` layout

