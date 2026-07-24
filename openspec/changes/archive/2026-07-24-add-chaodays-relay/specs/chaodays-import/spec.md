## ADDED Requirements

### Requirement: Egress to chaodays goes through a configurable relay

The backend SHALL send its chaodays requests to a configurable base URL — a relay
when one is provisioned, the direct chaodays API otherwise — because chaodays
blocks requests originating from a Cloudflare Worker. When a relay base URL is
configured, all chaodays requests (sign-in and every data fetch) SHALL target that
base and SHALL carry a shared-secret header identifying the caller to the relay;
when it is not configured, requests SHALL go directly to the chaodays API as
before. The choice of base URL SHALL NOT change the request paths, bodies, auth
headers, session-token rotation, or the import behavior and error mapping — only
the host the request is sent to.

#### Scenario: Requests target the relay when configured
- **WHEN** the client is configured with a relay base URL and secret
- **THEN** every chaodays request (sign-in and data fetches) is sent to that base URL and includes the `X-Relay-Secret` header carrying the configured secret

#### Scenario: Requests go directly when no relay is configured
- **WHEN** no relay base URL is configured
- **THEN** requests go to the direct chaodays API base and no relay secret header is added, exactly as before this change

#### Scenario: The relay only forwards authenticated callers
- **WHEN** the relay receives a request without the correct `X-Relay-Secret` header
- **THEN** the relay rejects it with `403` and does not forward it to chaodays, so the relay never acts as an open proxy
