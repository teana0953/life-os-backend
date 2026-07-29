## ADDED Requirements

### Requirement: Administrator flag

A user record SHALL carry an administrator flag that defaults to false. The flag
SHALL be the single authority for whether the caller may use admin-only
endpoints. Granting the flag is an out-of-band operation (direct data change);
the system SHALL NOT expose an endpoint that sets it.

#### Scenario: New account is not an administrator
- **WHEN** a user record is created on first authenticated request
- **THEN** the record's administrator flag is false

#### Scenario: Existing flag survives a later login
- **WHEN** an authenticated request arrives for a user whose administrator flag is already true
- **THEN** the get-or-create path returns the existing record with the flag still true

#### Scenario: Flag is readable by the authorization layer
- **WHEN** an authenticated request reaches an admin-only endpoint
- **THEN** the system resolves the caller's user record and reads its administrator flag to decide whether to proceed

## MODIFIED Requirements

### Requirement: Current-user endpoint
The system SHALL expose `GET /api/me` as a protected route returning the authenticated user's profile as JSON, including whether the user is an administrator so a client can decide whether to offer administrator-only actions.

#### Scenario: Authenticated profile fetch
- **WHEN** an authenticated client sends `GET /api/me`
- **THEN** the system responds `200` with JSON containing the user's `id`, `firebase_uid`, `email`, `display_name`, `created_at`, and `is_admin`

#### Scenario: Ordinary user reads the flag as false
- **WHEN** an authenticated client whose account has never been granted administrator sends `GET /api/me`
- **THEN** the response's `is_admin` is false
