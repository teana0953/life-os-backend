# auth Specification

## Purpose
TBD - created by archiving change add-walking-skeleton. Update Purpose after archive.
## Requirements
### Requirement: Firebase ID token verification
The system SHALL verify Firebase ID tokens on protected routes by validating the JWT signature against Google's securetoken JWKS and checking that `aud` equals the Firebase project ID and `iss` equals `https://securetoken.google.com/<project-id>`. Verification MUST NOT depend on the firebase-admin SDK.

#### Scenario: Valid token
- **WHEN** a request to a protected route carries `Authorization: Bearer <token>` with a valid signature, unexpired `exp`, correct `aud` and `iss`
- **THEN** the request proceeds and the verified claims (uid, email) are available to the handler

#### Scenario: Expired token
- **WHEN** a request carries a token whose `exp` is in the past
- **THEN** the system responds `401` with JSON `{ "error": "unauthorized" }`

#### Scenario: Wrong audience
- **WHEN** a request carries a token whose `aud` does not match the Firebase project ID
- **THEN** the system responds `401` with JSON `{ "error": "unauthorized" }`

#### Scenario: Wrong issuer
- **WHEN** a request carries a token whose `iss` is not `https://securetoken.google.com/<project-id>`
- **THEN** the system responds `401` with JSON `{ "error": "unauthorized" }`

#### Scenario: Invalid signature
- **WHEN** a request carries a token signed by a key not present in the JWKS
- **THEN** the system responds `401` with JSON `{ "error": "unauthorized" }`

### Requirement: Protected routes reject missing credentials
The system SHALL respond `401` to any request to a protected route that lacks a syntactically valid `Authorization: Bearer` header.

#### Scenario: No Authorization header
- **WHEN** a request to a protected route has no `Authorization` header
- **THEN** the system responds `401` with JSON `{ "error": "unauthorized" }`

