# CLAUDE.md — life-os-backend

Architecture conventions for this repo. Read before adding or modifying any
backend code (human or AI agent).

## AI development: graphflow gate (mandatory judgment, per request)

The gate is evaluated **per user request, never per session**. Before
starting any AI-assisted development task in this repo, explicitly decide
whether to run it through the graphflow workflow engine (`/graphflow`), and
state the decision plus a one-line reason **before touching code**. Either
outcome is acceptable; skipping the judgment is not.

**An earlier decision in this session does not carry over.** Re-judge from
scratch — and restate the decision — every time one of these happens:

- a new request arrives, however short the phrasing
- the scope outgrows what the last judgment covered (more files, new
  behaviour, a design question appears)
- work resumes after review, or a commit is appended to an
  already-reviewed branch/PR
- the task type changes (doc tweak → feature, one-liner → refactor)

Never reason like this:

- "this session already decided to skip graphflow"
- "same task continues, so the earlier decision stands"
- "the user didn't ask for graphflow this time"

User silence is not a decision to skip. Making the call and stating it is
yours to do, once per request.

- **Use graphflow** for multi-stage work: feature development, non-trivial
  bugfixes, refactors — anything that benefits from a design → implement →
  review pipeline or spans multiple files/contexts.
- **Skip graphflow** for small mechanical changes (typos, single-file
  tweaks, doc edits, renames) — the workflow overhead outweighs the benefit
  there.

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
