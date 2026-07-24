## ADDED Requirements

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

### Requirement: Subscription secrets and test content are privacy-preserving

Subscription secrets SHALL never be logged, and the test push SHALL carry no
personal data.

#### Scenario: Subscription secrets are not logged
- **WHEN** any push request is handled (success or error)
- **THEN** the subscription `endpoint`, `p256dh`, and `auth` are not written to logs

#### Scenario: Test push content is generic
- **WHEN** a test push is sent
- **THEN** its content is a fixed generic string containing no personal data
