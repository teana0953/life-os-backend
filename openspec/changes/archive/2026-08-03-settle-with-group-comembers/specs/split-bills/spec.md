## MODIFIED Requirements

### Requirement: Settlements follow the same authorization rules as expenses

Creating a settlement SHALL require the caller to be its payer or its payee,
and the other party to be a friend of the caller **or someone they share a
group with** — deliberately looser than creating a groupless expense, which
requires friendship, because a debt can arise purely through a shared group
between two people who never became friends and refusing to settle it would
leave that balance with no way to clear it. Within a group, the other party
must be a member of it; a grouped settlement SHALL involve only members of that group.
A settlement SHALL be visible only to its payer, its payee, or the members of
its group, and SHALL be deletable only by the user who created it or the one
who paid. Every other caller SHALL receive `404`, never `403`.

#### Scenario: A repayment between two other people cannot be recorded

- **WHEN** a user records a settlement naming two other people, with
  themselves as neither payer nor payee
- **THEN** the request is rejected with `400`

#### Scenario: A stranger's listing never contains the settlement

- **WHEN** a user who is neither party nor a member of its group lists
  settlements — unfiltered, or filtered to a group they do not belong to
- **THEN** the settlement is absent, and the group filter answers `404`

#### Scenario: A payee cannot delete a settlement

- **WHEN** the payee, who did not create it, tries to delete a settlement
- **THEN** the response is `404` and the settlement is unchanged

#### Scenario: A non-friend cannot be settled with

- **WHEN** a settlement names someone who is neither a friend of the caller
  nor a member of its group
- **THEN** the request is rejected with `400`

#### Scenario: Malformed identifiers do not reach the database

- **WHEN** a settlement is requested with a path id that is not a UUID, or
  submitted with a body id that is not a UUID
- **THEN** the response is `404` or `400` respectively, never `500`

#### Scenario: A group co-member who is not a friend can be settled with

- **WHEN** two people share a group but are not friends, and one records a
  person-to-person repayment to the other
- **THEN** it is accepted — they still could not create a groupless expense
  together, only settle a debt they already have
