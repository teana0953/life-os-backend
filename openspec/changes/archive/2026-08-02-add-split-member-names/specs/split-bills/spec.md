## MODIFIED Requirements

### Requirement: Groups collect members who are already friends

A group SHALL be created with its creator as the first member. A member MAY
add another user only if that user is already their friend. Group details and
membership SHALL be visible only to members; anyone else receives `404`.
Every member SHALL be returned with a display name, so a client never has to
render a bare identifier — including a member whose balance nets to zero and
who therefore appears in no balance listing. The group listing SHALL carry
each group's members, resolved in a single lookup rather than one per group.

#### Scenario: The creator is a member

- **WHEN** a user creates a group
- **THEN** they are listed as a member of it

#### Scenario: A member adds a friend

- **WHEN** a member adds a user who is their friend
- **THEN** that user becomes a member

#### Scenario: A stranger cannot be added

- **WHEN** a member tries to add a user who is not their friend
- **THEN** the request is rejected with `400`

#### Scenario: Adding an existing member is a bad request

- **WHEN** a member adds a user who is already a member of that group
- **THEN** the request is rejected with `400`, not `500`, and the membership
  is unchanged

#### Scenario: A non-member cannot read the group

- **WHEN** a user who is not a member requests the group
- **THEN** the response is `404`

#### Scenario: Members carry their names

- **WHEN** a member reads a group's details or lists their groups
- **THEN** every member is returned with a display name, including one whose
  balance is settled

#### Scenario: Names cost one lookup, not one per group

- **WHEN** a caller lists several groups
- **THEN** the members of all of them are resolved in a single lookup
