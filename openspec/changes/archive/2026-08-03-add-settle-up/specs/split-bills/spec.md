## ADDED Requirements

### Requirement: Settlements record a repayment as itself

A repayment SHALL be recorded as its own kind of record — who paid whom, how
much, in which currency, on which day, optionally within a group and with a
note — never as a reversed expense. The amount SHALL be a positive integer in
the currency's minor units, and the payer and payee SHALL be different people.

#### Scenario: A repayment is recorded

- **WHEN** a user records paying 450 TWD to a friend they owe
- **THEN** a settlement exists naming both of them, the amount, the currency
  and the day

#### Scenario: Paying yourself is rejected

- **WHEN** a settlement names the same user as payer and payee
- **THEN** the request is rejected with `400`

#### Scenario: A non-positive or oversized amount is rejected

- **WHEN** a settlement is submitted with an amount of `0` or less, or above
  what the amount column can hold
- **THEN** the request is rejected with `400`, never as a server error

#### Scenario: Repayments are not edited in place

- **WHEN** a user needs to correct a repayment
- **THEN** they delete it and record it again — there is no partial update
  path that could skip the creation rules

### Requirement: Settlements reduce what is owed, in the right direction

A balance SHALL net settlements against split shares — refining the
definition of a balance as the net of shares alone — in the direction that
reduces what is actually owed. A personal balance counts **every** settlement
between the pair whether or not it names a group, matching the fact that it
already counts every expense between them; a group balance counts only that
group's settlements. A personal balance is reported about the other
person, so being repaid by them SHALL reduce it. A group balance is reported
about each member, so a member repaying someone SHALL move their own figure
toward zero. Group balances SHALL still sum to zero per currency, but that
sum SHALL NOT be relied on as the check that the direction is right — it
holds under either sign convention — so the direction SHALL be pinned by
asserting the signed figure of a named person.

#### Scenario: Being repaid reduces what they owe

- **WHEN** someone owes the caller 450 TWD and repays 450 TWD
- **THEN** the balance between them in TWD is settled and no longer listed

#### Scenario: Repaying reduces what the caller owes

- **WHEN** the caller owes 450 TWD and repays 300 TWD
- **THEN** the caller now owes 150 TWD — not 750

#### Scenario: Overpaying flips the balance

- **WHEN** the caller owes 450 TWD and repays 600 TWD
- **THEN** the balance shows the other person owing the caller 150 TWD —
  overpaying is a real situation and is not refused

#### Scenario: A repaying group member moves toward zero, by name

- **WHEN** group member B owes 450 TWD and repays 300 TWD to A
- **THEN** B's group figure is −150 and A's is +150 — asserted per member and
  signed, not merely summing to zero, which would pass with the signs swapped

#### Scenario: A group still nets to zero after a repayment

- **WHEN** one group member repays another and the group's balances are
  listed for that currency
- **THEN** they still sum to zero — a sanity check, not the direction check

#### Scenario: A group settlement also settles the pairwise balance

- **WHEN** two people who are both group members settle a debt with the
  group named
- **THEN** both the group balance and their personal balance with each other
  reflect it

#### Scenario: Currencies stay apart

- **WHEN** a repayment is made in one currency between two people who also
  have expenses in another
- **THEN** only that currency's balance changes

### Requirement: Settlements follow the same authorization rules as expenses

Creating a settlement SHALL require the caller to be its payer or its payee,
and the other party to be a friend of the caller or — within a group — a
member of it; a grouped settlement SHALL involve only members of that group.
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

### Requirement: An archived group takes no new settlements but keeps them correctable

An archived group SHALL refuse new settlements, for the same reason it
refuses new expenses, while its existing settlements SHALL remain readable
and deletable — so a mistaken repayment is never frozen in place.

#### Scenario: An archived group refuses a new repayment

- **WHEN** a settlement is submitted for an archived group
- **THEN** the request is rejected

#### Scenario: An existing repayment in an archived group can still be removed

- **WHEN** the creator deletes a settlement belonging to an archived group
- **THEN** it is deleted and the balances update
