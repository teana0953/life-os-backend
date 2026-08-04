## MODIFIED Requirements

### Requirement: Continuous integration on proposed changes

The system SHALL run type-checking and the test suite automatically on every
pull request and on pushes to non-default branches, and the check MUST fail
the workflow when either type-checking or tests fail. The suite SHALL include a project that executes real SQL against a real
PostgreSQL engine with the project's own migrations applied, so that queries
covered by it cannot pass merely because a test double discarded their
arguments. That engine SHALL require no external service or container, so CI
needs no additional configuration. **Coverage is partial by design**: the
repositories not yet covered keep their argument-discarding doubles, so the
suite passing does not by itself mean every query in the codebase is right.

#### Scenario: Passing branch

- **WHEN** a pull request is opened or updated and both `npm run typecheck` and `npm test` succeed
- **THEN** the CI workflow completes successfully

#### Scenario: Failing tests block the branch

- **WHEN** a pull request contains code where `npm test` fails
- **THEN** the CI workflow fails and reports the failure on the pull request

#### Scenario: A wrong query fails the suite, where it is covered

- **WHEN** one of the covered queries is changed so that it filters, joins or
  signs a value incorrectly
- **THEN** the suite fails — that query is executed against a real engine
  rather than a double that ignores what was passed to it

#### Scenario: Uncovered queries are not claimed

- **WHEN** a query outside the covered set is changed incorrectly
- **THEN** the suite may still pass, and that is a known and stated limit
  rather than a guarantee this requirement makes
