# ci-cd — Delta Spec

## ADDED Requirements

### Requirement: Continuous integration on proposed changes
The system SHALL run type-checking and the test suite automatically on every pull request and on pushes to non-default branches, and the check MUST fail the workflow when either type-checking or tests fail.

#### Scenario: Passing branch
- **WHEN** a pull request is opened or updated and both `npm run typecheck` and `npm test` succeed
- **THEN** the CI workflow completes successfully

#### Scenario: Failing tests block the branch
- **WHEN** a pull request contains code where `npm test` fails
- **THEN** the CI workflow fails and reports the failure on the pull request

### Requirement: Automatic deployment on merge to main
The system SHALL, on every push to the default branch (`main`), apply database migrations and then deploy the Worker to Cloudflare, in that order, aborting deployment if migration fails.

#### Scenario: Successful delivery
- **WHEN** a commit is pushed to `main` and migrations apply cleanly
- **THEN** the CD workflow deploys the Worker to Cloudflare using the configured API token

#### Scenario: Migration failure aborts deploy
- **WHEN** a commit is pushed to `main` and the migration step fails
- **THEN** the CD workflow stops and does not deploy the Worker

### Requirement: Runtime secrets sourced from CI
The system SHALL provision the Worker's runtime secrets (`DATABASE_URL`, `FIREBASE_PROJECT_ID`) from GitHub-managed secrets as part of the deploy step, so that no manual secret configuration in Cloudflare is required and GitHub remains the single source of truth.

#### Scenario: Secrets uploaded during deploy
- **WHEN** the CD workflow deploys the Worker
- **THEN** it uploads `DATABASE_URL` and `FIREBASE_PROJECT_ID` to the Worker from the corresponding GitHub secrets

### Requirement: Post-deploy smoke test
The system SHALL, after deploying, verify the live endpoint and fail the workflow if the service does not respond as expected.

#### Scenario: Healthy deployment
- **WHEN** the CD workflow runs its smoke test against the deployed URL
- **THEN** `GET /health` returns `200` and `GET /api/me` without a token returns `401`

#### Scenario: Broken deployment surfaces
- **WHEN** the post-deploy `GET /health` does not return `200`
- **THEN** the CD workflow is marked failed

### Requirement: Workflow definitions are statically validated
The repository's GitHub Actions workflow files SHALL pass `actionlint` static validation as part of the project's quality gate.

#### Scenario: Malformed workflow caught before merge
- **WHEN** a workflow YAML contains an invalid expression or key
- **THEN** the `actionlint` gate fails
