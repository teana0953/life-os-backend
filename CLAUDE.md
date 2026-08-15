# CLAUDE.md — life-os-backend

Architecture conventions for this repo. Read before adding or modifying any
backend code (human or AI agent).

## AI development: graphflow is mandatory (flow choice is the per-request judgment)

**Every AI-assisted development task in this repo runs through the graphflow
workflow engine — `/graphflow:graphflow`, plugin version v0.2.1 or later.**
Running the work by hand instead of through graphflow is not an option. The
only per-request judgment left is **which flow**: `light` or `full`.

```
/graphflow:graphflow run <graph> --flow light   # small, low-risk
/graphflow:graphflow run <graph> --flow full    # everything else
```

`--flow light` (added in v0.2.0) prunes the plan-approval gate and the
secondary review legs; script verification, at least one code review, and the
final ship gate stay in **both** flows. Light trims process overhead, never
the quality floor.

- **`--flow light`** — single file, low risk, no interface/UI change: typo
  fixes, doc edits, renames, mechanical tweaks, one-line bugfixes.
- **`--flow full`** — everything else: feature development, non-trivial
  bugfixes, refactors, anything spanning multiple files/contexts, anything
  touching a public interface or the UI.
- **Unsure → ask the user.** Do not silently pick light to save time.

State the chosen flow plus a one-line reason **before touching code**.

**The flow judgment is per user request, never per session.** An earlier
choice does not carry over. Re-judge from scratch — and restate it — every
time one of these happens:

- a new request arrives, however short the phrasing
- the scope outgrows what the last judgment covered (more files, new
  behaviour, a design question appears)
- work resumes after review, or a commit is appended to an
  already-reviewed branch/PR
- the task type changes (doc tweak → feature, one-liner → refactor)

Never reason like this:

- "this session already decided the flow"
- "same task continues, so the earlier choice stands"
- "the user didn't ask for graphflow this time"
- "this one is too small for graphflow" — too small means `--flow light`,
  not skipping the engine

User silence is not permission to skip. Making the call and stating it is
yours to do, once per request.

Reference: <https://github.com/teana0953/graphflow>. If the installed plugin
is older than v0.2.1, `--flow` is unavailable — update it (`/plugin update
graphflow`) before starting.

## Architecture: Clean Architecture + DDD (hexagonal naming, context-first structure)

```
Flutter (future) ──HTTPS──▶ Workers (Hono, driving adapter)
                              ├─ authMiddleware: jose × Google JWKS (shared technical component)
                              ├─ use cases (application layer, inbound port)
                              └─ UserRepository port ◀─ DrizzleUserRepository (driven adapter) ──▶ Neon
```

### Dependency rule

- `domain` imports nothing from outer layers. It defines entities and **ports**
  (interfaces) that outer layers implement or call.
- `application` depends only on `domain` and ports. It contains use cases
  (inbound ports) that orchestrate domain logic via injected repository ports.
- `adapters` implement ports (**driven adapters**, e.g. `DrizzleUserRepository`)
  or drive the application from the outside (**driving adapters**, e.g. the
  Hono HTTP layer).
- Dependencies always point inward: `adapters → application → domain`. Nothing
  in `domain` or `application` may import from `adapters` or `shared/db`,
  `shared/auth`, etc.
- The composition root (`src/index.ts`) is the only place that wires concrete
  adapters into use cases via manual dependency injection — no DI framework.

`shared/` means cross-context **infrastructure** (today: `db/`, `auth/`), which
is why the rule above forbids it inward. Pure, dependency-free logic that more
than one context genuinely needs goes in **`shared-kernel/`** instead (DDD's
term for a small model two bounded contexts agree to share). A shared kernel
sits at domain level, so `domain`/`application` may import it — that points
inward, not outward.

Keep it small and keep the distinction sharp: anything with I/O, a client, or a
connection belongs in `shared/` and stays out of the inner layers; anything
that is one context's business rule stays in that context. `shared-kernel/` is
for the rest, and today that is one file (`reminder-clock.ts`, timezone-aware
calendar math needed by both notifications and finance).

### Bounded contexts (context-first structure)

The codebase is organized **by context first, by layer second**:

```
src/
  contexts/
    <context>/
      domain/          # entities, value objects, repository ports (interfaces)
      application/      # use cases (inbound ports), depend only on domain
      adapters/          # driven adapters implementing domain ports (e.g. DB repos)
  shared/
    auth/                # cross-context technical building blocks (JWT verification)
    db/                   # Drizzle schema + Neon client factory
  adapters/
    http/                 # driving adapter: Hono app, middleware, routes — kept thin
  index.ts                 # composition root (manual DI)
```

Each business module (health, cancer-care, finance, inventory, travel,
documents, …) becomes its own context under `src/contexts/`, copying the
`contexts/user/` layout. If a context ever needs to become an independent
service, its folder can be moved out as a unit.

Keep the tactical pattern set lightweight: entity + repository port is enough
until a context needs more (domain events, factories, etc.) — don't add those
speculatively (YAGNI).

### Naming conventions

- Driven adapters are named **`<TechnologyPrefix><PortName>`**
  (e.g. `DrizzleUserRepository` implements the `UserRepository` port). Do not
  use an `~Adapter` suffix.
- Ports (interfaces) live in `domain/` and are named after the capability
  they expose (e.g. `UserRepository`, not `IUserRepository`).

### Adding a new context

1. Copy the `src/contexts/user/` folder layout (`domain/`, `application/`,
   `adapters/`) for the new context name.
2. Define entities and repository ports in `domain/`.
3. Define use cases in `application/`, depending only on `domain`.
4. Implement ports in `adapters/` (e.g. a `Drizzle<X>Repository`).
5. Wire routes under `src/adapters/http/routes/` and inject the new use cases
   from `src/index.ts`.

## Comments

Default: **don't write a comment.** If the code reads clearly on its own,
leave it alone — this includes `/** ... */` doc comments: a doc comment that
only restates the class name and its `implements` clause (e.g. `/** Driven
adapter: implements SettlementRepository via Drizzle + Neon. */` on
`class DrizzleSettlementRepository implements SettlementRepository`) is still
a comment that shouldn't exist.

Write a comment only when it carries something the code can't say by itself:

- **Why, not what** — a design decision or a rejected alternative. E.g.
  `src/shared/db/read-only-query.ts` explains why the allowlist is
  deliberately not a SQL tokenizer: a false negative just costs a retry, but
  a false positive could double a stock decrement or a ledger row.
- **A bug or incident you already hit** — so the next person doesn't
  reintroduce it. E.g. `src/shared/db/client.ts` records the actual timestamp
  and shape of a 520 incident that motivated the current retry behavior.
- **A platform limitation that shapes the code around it.** E.g.
  `src/contexts/health/adapters/http-chaodays-client.ts`: a realistic
  browser `User-Agent` is set so a WAF/bot rule doesn't reject the worker's
  default UA — an obvious-looking simplification would get the client
  blocked.
- **Why not the obvious/simpler approach.** E.g.
  `src/contexts/notifications/adapters/care-reminder-loop.ts` notes that a
  Workflows step name is deliberately kept as-is even though its anchor
  changed, because the step name is a persisted identifier and renaming it
  would desync in-flight instances.
- **Units, formats, or timezone/DST handling that a bare type can't express.**
  E.g. `/** The repayment, in the currency's minor units. */` on a plain
  `number` field, or the DST gap/fold handling in
  `src/shared-kernel/reminder-clock.ts`.
- **Boundary conditions and invariants**, especially ones enforced across
  files. E.g. `src/contexts/split/domain/balance.ts`: "Positive = they owe
  the viewer; negative = the viewer owes them. Never zero — zero-net
  currencies are omitted (design.md)."
- **Comments with real semantic effect**: `// eslint-disable*`,
  `// @ts-expect-error` / `@ts-ignore` / `@ts-nocheck`, `// coverage:ignore*`
  / `// v8 ignore` / `// c8 ignore`, `@internal` / `@deprecated` — deleting
  these changes what the linter/type-checker/coverage tool does, not just
  what a reader sees. Keep any `--` reasoning attached to them.
- **File-header authorship/generator/license banners.**
- **In tests: what failure mode a test guards against, or why a fixture is
  shaped the way it is.** A pure `// Arrange` / `// Act` / `// Assert` label
  or a comment that just translates the next line's assertion into English
  adds nothing and can go; a comment naming the edge case, the boundary
  being exercised, or why two tests are a deliberate pair does not. Any
  comment mentioning mutation testing / a mutation survivor, an issue
  number, a design.md clause, or a real-device measurement stays.
- **`TODO` / `FIXME` / `HACK` markers**, and commented-out code — leave both
  alone; this sweep doesn't touch either.

When unsure whether a comment adds information, leave it — the cost of one
extra sentence is far lower than the cost of re-discovering a lesson someone
already paid to learn.

## Testing strategy

- **domain / application layers**: plain Vitest unit tests. Use cases are
  tested with an in-memory repository implementing the port — no Workers
  runtime involved. These run under the `unit` Vitest project (plain Node,
  no `workerd`).
- **shared technical components / HTTP adapters**: Vitest with
  `@cloudflare/vitest-pool-workers` (`workers` project), since these exercise
  Workers-runtime-specific behavior (JWKS verification, Hono routing). HTTP
  route tests inject fake repositories/verifiers rather than hitting real
  infrastructure.
- Run everything with `npm test` (runs both Vitest projects). Type-check with
  `npm run typecheck`.

## Error handling

- Missing/invalid auth → `401` `{ "error": "unauthorized" }`.
- Unexpected/internal failures → `500` `{ "error": "internal" }` (never leak
  stack traces, driver messages, or connection strings).
- Handled centrally via Hono's `onError` in `src/adapters/http/app.ts`.

## Secrets

- `DATABASE_URL` and `FIREBASE_PROJECT_ID` are read from Workers environment
  bindings, never hardcoded or committed. Locally, use an untracked
  `.dev.vars` file (see `.dev.vars.example` for the required keys). In
  deployed environments, set them with `wrangler secret put <NAME>`.
