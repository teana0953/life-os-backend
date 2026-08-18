# web-push Specification

## Purpose
TBD - created by archiving change add-web-push-foundation. Update Purpose after archive.
## Requirements
### Requirement: Register, replace, and remove a Web Push subscription

An authenticated lifeos user SHALL be able to register a Web Push subscription
(`endpoint`, `p256dh`, `auth`) for their device, re-register the same endpoint
idempotently, and remove a subscription by endpoint. All subscription endpoints are
managed per user.

#### Scenario: Subscribing stores the subscription
- **WHEN** an authenticated user POSTs `/api/push/subscribe` with a valid `endpoint`, `p256dh`, and `auth`
- **THEN** the subscription is stored for that user and the request succeeds

#### Scenario: Re-subscribing the same endpoint is idempotent
- **WHEN** a user subscribes with an `endpoint` that is already stored
- **THEN** the existing row is updated in place (no duplicate is created)

#### Scenario: Missing subscription fields are rejected
- **WHEN** the request omits `endpoint`, `p256dh`, or `auth`
- **THEN** the API returns 400

#### Scenario: A non-https endpoint is rejected
- **WHEN** the request's `endpoint` is not a valid `https://` URL
- **THEN** the API returns 400 (the test push later fetches this endpoint, so a non-https / malformed value is refused at subscribe time)

#### Scenario: Unsubscribing is idempotent
- **WHEN** a user DELETEs `/api/push/subscribe` for an endpoint, whether or not it currently exists
- **THEN** the subscription is absent afterwards and the request succeeds

#### Scenario: Subscription endpoints require authentication
- **WHEN** a subscribe, unsubscribe, or test request arrives without a valid lifeos token
- **THEN** the API returns 401

### Requirement: Retrieve the VAPID public key

An authenticated lifeos user SHALL be able to fetch the server's VAPID public key,
which the browser needs in order to create a push subscription.

#### Scenario: The configured public key is returned
- **WHEN** an authenticated user GETs `/api/push/vapid-public-key`
- **THEN** the response contains the configured VAPID public key

### Requirement: Send a test push to the user's subscriptions

An authenticated lifeos user SHALL be able to trigger a test push, which is
delivered to every subscription they have registered, and the response SHALL report
how many were sent and how many failed.

#### Scenario: Test push is attempted for each subscription
- **WHEN** an authenticated user POSTs `/api/push/test` and has one or more subscriptions
- **THEN** a fixed generic test message is sent to each subscription and the response reports the sent and failed counts

#### Scenario: An expired subscription is pruned
- **WHEN** the push service reports a subscription as gone (HTTP 404 or 410) while sending a test push
- **THEN** that subscription is deleted, while subscriptions that merely failed transiently are kept

### Requirement: Every push states its own hold time, and reminders state their urgency

Each push message SHALL carry its own RFC 8030 `TTL`, chosen by the caller, and
SHALL send an `Urgency` header only when the caller chose one.

#### Scenario: A nagging reminder is held only until its next nag
- **WHEN** a care slot with a nag interval of 5 minutes is dispatched
- **THEN** the request to the push service carries `TTL: 300`, so at most one copy of that slot is ever live

#### Scenario: A fire-once reminder is held for the first-fire grace window
- **WHEN** a care slot with no nag interval is dispatched
- **THEN** the request carries `TTL: 600`

#### Scenario: A care reminder is marked urgent
- **WHEN** a care reminder is dispatched
- **THEN** the request carries `Urgency: high`

#### Scenario: A budget alert carries no urgency and outlives the day
- **WHEN** a budget alert is pushed
- **THEN** the request carries `TTL: 86400` and no `Urgency` header at all

### Requirement: Record whether a device actually received a reminder

The push service's acceptance SHALL NOT be treated as delivery. For each care
reminder sent to each device, the system SHALL record a delivery row carrying a
one-time acknowledgement token's hash, and SHALL mark it acknowledged when the
device reports back.

#### Scenario: A delivery row exists before the push is sent
- **WHEN** a care round dispatches to a user's subscriptions
- **THEN** one delivery row per subscription is written before the first push goes out, so an ack that arrives immediately has somewhere to land

#### Scenario: Each device gets its own token
- **WHEN** a user has two subscriptions
- **THEN** each receives a different acknowledgement token, and only the tokens' hashes are stored

#### Scenario: A device acknowledges without any lifeos token
- **WHEN** a service worker POSTs `/api/push/ack` with `{"ack": "<token>"}` and no `Authorization` header
- **THEN** the API returns 204 and the matching delivery row is marked acknowledged

#### Scenario: An acknowledgement changes no reminder behaviour
- **WHEN** a delivery is acknowledged
- **THEN** nagging, retry timing, and the occurrence's own send outcome are unchanged — only `care_log` ends a nag

#### Scenario: An unknown, expired, or replayed acknowledgement changes nothing
- **WHEN** the token is not one that was issued, or its TTL has elapsed, or it was already acknowledged
- **THEN** no row is written, and the API still returns 204 so the endpoint reveals nothing about which tokens exist

#### Scenario: Malformed acknowledgements cost no database work
- **WHEN** the body is not JSON, has no `ack` field, carries a wrong-shaped token, or exceeds 1 KB
- **THEN** the API returns 204 without querying the database

#### Scenario: Only the acknowledgement route is unauthenticated
- **WHEN** any other `/api/push/*` request arrives without a valid lifeos token
- **THEN** the API returns 401

### Requirement: Subscription secrets and test content are privacy-preserving

Subscription secrets SHALL never be logged, and the test push SHALL carry no
personal data.

#### Scenario: Subscription secrets are not logged
- **WHEN** any push request is handled (success or error)
- **THEN** the subscription `endpoint`, `p256dh`, and `auth` are not written to logs

#### Scenario: Test push content is generic
- **WHEN** a test push is sent
- **THEN** its content is a fixed generic string containing no personal data

#### Scenario: Acknowledgement tokens are never logged or stored in the clear
- **WHEN** an acknowledgement is handled, successfully or not
- **THEN** the token is not written to logs, and the stored delivery row holds only its hash

