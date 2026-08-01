# friends Specification

## Purpose
TBD - created by archiving change add-friends. Update Purpose after archive.
## Requirements
### Requirement: Friendship requires both sides to agree

A friendship SHALL exist only after one user invites and another accepts. It
SHALL be stored as a single normalized row per pair, so the same two people
can never hold two friendships, whichever direction the invite went. Either
side SHALL be able to end the friendship, which removes it for both.

#### Scenario: Invite and accept creates one friendship

- **WHEN** user A invites and user B accepts
- **THEN** the two are friends, and the same friendship is returned whether A
  or B lists their friends

#### Scenario: The reverse direction does not create a second friendship

- **WHEN** A and B are already friends and B invites A, who accepts
- **THEN** no second friendship is created

#### Scenario: Either side can end it

- **WHEN** B removes A
- **THEN** neither A nor B lists the other as a friend

### Requirement: Invite links are single-use and expire

An invite SHALL carry a high-entropy token that the system stores only as a
hash, returning the plaintext once at creation. An invite SHALL become
unusable once accepted, once revoked by its creator, or seven days after
creation, and each of those SHALL be distinguishable to the caller so the
user can be told why. Accepting SHALL be atomic: two people accepting the
same invite simultaneously SHALL result in exactly one friendship and one
consumed invite. Users SHALL only list or revoke their own invites.

#### Scenario: An invite works once

- **WHEN** an invite is accepted and then the same link is opened and
  accepted again by someone else
- **THEN** the second attempt fails, and the friendship from the first
  attempt is untouched

#### Scenario: Expiry, revocation, and reuse are told apart

- **WHEN** an invite has expired, or was revoked, or was already accepted
- **THEN** each failure is reported distinctly rather than as one generic
  error

#### Scenario: Re-opening a link you already used

- **WHEN** a user who is already friends with the inviter opens the same link
  again
- **THEN** they are told they are already friends rather than seeing an
  error, and no further invite is consumed

#### Scenario: Two people accepting at once

- **WHEN** two users accept the same invite at the same moment
- **THEN** exactly one friendship exists and the invite is consumed once;
  the other attempt is told the invite is already used, and no partially
  applied state remains (an invite is never consumed without its friendship)

#### Scenario: Invites belong to their creator

- **WHEN** a user lists or revokes invites
- **THEN** only their own invites are visible or revocable; another user's
  invite is indistinguishable from a missing one

#### Scenario: You cannot befriend yourself

- **WHEN** a user opens and accepts their own invite
- **THEN** the request fails and no friendship is created

### Requirement: Friends are exposed by name only

Responses about friends and invites SHALL carry a display name and never an
email address. When a user has no display name, the system SHALL derive one
from the local part of their email rather than exposing the address itself.
The system SHALL NOT offer any endpoint that looks a user up by email or
name.

#### Scenario: No email in any friend-facing response

- **WHEN** a user lists friends, or previews an invite
- **THEN** the response contains display names and no email addresses, and
  no internal user identifiers beyond what the caller needs to act

#### Scenario: Missing display name falls back to a prefix

- **WHEN** a friend has no display name set
- **THEN** their name is shown as the part of their email before the `@`,
  with the rest of the address absent

