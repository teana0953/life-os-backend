## MODIFIED Requirements

### Requirement: An expense and its shares are written atomically

Creating or editing an expense SHALL write the expense row, its share rows
and the share holders' mirrored finance transactions in a single database
statement batch, so a failure can never leave an expense whose shares do not
sum to its amount, nor a split whose mirrors disagree with it. The identifier
SHALL be generated before the write so every part of the batch can reference
it. Deleting an expense SHALL remove its mirrors in the same write.

Mirrors join this batch rather than following it because the driver has no
transaction support: a mirror written afterwards could fail on its own,
leaving a permanent disagreement between the two views that nothing would
detect or repair.

#### Scenario: A failed write leaves nothing behind

- **WHEN** writing an expense's shares fails
- **THEN** no expense row remains that has no shares or mismatched shares

#### Scenario: A failed mirror leaves no split behind either

- **WHEN** writing a share holder's mirrored transaction fails
- **THEN** no expense row, share row or mirror remains from that write
