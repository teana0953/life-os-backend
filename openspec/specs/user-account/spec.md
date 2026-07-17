# user-account Specification

## Purpose
TBD - created by archiving change add-walking-skeleton. Update Purpose after archive.
## Requirements
### Requirement: Automatic account provisioning on first login
The system SHALL create a user record on the first authenticated request from a Firebase identity, keyed by a unique `firebase_uid`, storing email and display name from the verified token claims. Subsequent requests from the same identity MUST NOT create duplicate records.

#### Scenario: First authenticated request
- **WHEN** an authenticated request arrives and no user row exists for the token's `firebase_uid`
- **THEN** the system creates a user row with `firebase_uid`, `email`, `display_name` from the claims

#### Scenario: Returning user
- **WHEN** an authenticated request arrives and a user row already exists for the token's `firebase_uid`
- **THEN** the system reuses the existing row as-is (get-or-create semantics: no duplicate is created and the stored `email` / `display_name` are not refreshed from the token)

### Requirement: Current-user endpoint
The system SHALL expose `GET /api/me` as a protected route returning the authenticated user's profile as JSON.

#### Scenario: Authenticated profile fetch
- **WHEN** an authenticated client sends `GET /api/me`
- **THEN** the system responds `200` with JSON containing the user's `id`, `firebase_uid`, `email`, `display_name`, `created_at`

