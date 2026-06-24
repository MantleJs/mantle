# Mantle JS

A full-stack, tech-agnostic JavaScript/TypeScript framework optimized for building real-time applications and scalable web APIs. Mantle serves as a flexible core layer between the database and the UI — analogous to the geological mantle sitting beneath the crust.

Mantle is designed to be **architecture-first**: it enforces a clean separation of concerns inspired by Clean Architecture and Onion Architecture, rather than coupling business logic to data access or transport concerns.

Mantle is built for three audiences: **indie developers** who want structure without ceremony, **startup teams** who need conventions that scale, and **AI coding agents** (Claude, Gemini, GPT-4o) that scaffold or generate backend code on behalf of a developer. Consistent naming, explicit interfaces, and clear layer boundaries make Mantle code correct to generate — an AI agent can produce a valid, runnable service with no human correction.

## Background & Motivation

**FeathersJS** is the closest analog to Mantle. It is a lightweight, real-time capable service framework with a strong following. However, it carries a structural limitation: **services couple business logic directly with data access logic**. A Feathers service is simultaneously a use case, a repository, and a controller. This works well for small applications but becomes a liability at scale, during testing, or when swapping infrastructure.

Other frameworks (NestJS, AdonisJS, Hapi) either impose too much framework opinion on domain code, require significant boilerplate, or are not optimized for real-time delivery.

Mantle takes direct inspiration from FeathersJS's ergonomics — the plugin model, adapters, hooks-style middleware — but reimagines the core around a **layered architecture** where:

- Domain logic is independent of infrastructure
- Services define _contracts_, not _implementations_
- Adapters and transports are swappable without touching business logic
- The framework is predictable enough to be scaffolded and consumed by AI agents

### Mantle vs. FeathersJS

| Concern            | FeathersJS                      | Mantle JS                          |
| ------------------ | ------------------------------- | ---------------------------------- |
| Service definition | Class implementing data + logic | Interface (contract) only          |
| Data access        | Inside the service via adapter  | Repository in Infrastructure layer |
| Business logic     | Mixed into service methods      | Isolated in Application / Domain   |
| Hooks              | Transport-aware                 | Transport-agnostic                 |
| Swapping databases | Requires service changes        | Swap adapter only                  |
| Testability        | Requires mocking transport      | Domain testable with no mocks      |
| AI scaffoldability | Moderate                        | High (clear boundaries)            |

## Architecture

```
Transport Layer       Express adapter — routes HTTP to services
Application Layer     Service<T> contracts, hook pipeline (a.k.a. THE MANTLE)
Domain Layer (Core)   Entities, Repository<T> interfaces
Infrastructure        KnexRepository — implements Domain interfaces
```

Dependencies always point inward. Nothing in Domain or Application layers knows about HTTP or databases.

## Packages

| Package                 | Description                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `@mantlejs/core`        | Framework kernel — Service, Repository, hooks, errors. Zero external deps.         |
| `@mantlejs/express`     | Express HTTP transport adapter                                                     |
| `@mantlejs/knex`        | SQL adapter via Knex.js (PostgreSQL, MySQL/MariaDB, SQLite3, MSSQL)                |
| `@mantlejs/auth`        | JWT engine + strategy runner                                                       |
| `@mantlejs/auth-local`  | Local email+password strategy (Argon2id)                                           |
| `@mantlejs/auth-oauth`  | Shared OAuth 2.0 base — state, PKCE, find-or-create, route registration            |
| `@mantlejs/auth-google` | Google Sign-In strategy (authorization code + PKCE, no Passport.js)                |
| `@mantlejs/auth-github` | GitHub Sign-In strategy (authorization code flow, no Passport.js)                  |
| `@mantlejs/upload`      | File upload via busboy, local disk storage                                         |
| `@mantlejs/logger`      | Structured logging — pino adapter, `logRequest` / `logError` hooks, correlation ID |
| `@mantlejs/schema`      | TypeBox schema validation (`validate`) and field resolution (`resolver`) hooks     |

## Quick Start

```typescript
import { mantle } from "@mantlejs/core";
import { express } from "@mantlejs/express";
import { knex } from "@mantlejs/knex";
import { auth, authenticate, sanitizeUser } from "@mantlejs/auth";
import { localStrategy, hashPassword } from "@mantlejs/auth-local";
import { logger, pinoAdapter, logRequest, logError } from "@mantlejs/logger";
import pino from "pino";

const app = mantle()
  .configure(express())
  .configure(knex({ client: "pg", connection: process.env.DATABASE_URL }))
  .configure(auth({ secret: process.env.JWT_SECRET! }))
  .configure(localStrategy())
  .configure(logger(pinoAdapter(pino({ level: process.env.LOG_LEVEL ?? "info" }))));

app.use("/users", new UserService(new UserRepository(app)), {
  methods: ["find", "get", "create", "update", "patch", "remove"],
});

const requestLogger = logRequest();

app.service("users").hooks({
  before: {
    create: [hashPassword()],
    all: [authenticate("jwt"), requestLogger],
  },
  after: { all: [sanitizeUser(), requestLogger] },
  error: { all: [requestLogger, logError()] },
});

app.listen(3030);
```

## Development

This monorepo is managed with [Nx](https://nx.dev).

```bash
# Build
npx nx build core                   # build one package
npx nx run-many -t build            # build all packages

# Test
npx nx test core                    # test one package
npx nx run-many -t test             # test all packages

# Lint
npx nx run-many -t lint

# Visualise the dependency graph
npx nx graph
```

### Add a new package

```bash
NX_DAEMON=false npx nx g @nx/js:library \
  --name=<name> \
  --directory=packages/<name> \
  --bundler=tsc \
  --unitTestRunner=vitest \
  --linter=eslint \
  --publishable \
  --importPath=@mantlejs/<name>
```

## Tech Choices

| Decision              | Choice                        | Reason                                                                                         |
| --------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| Monorepo              | Nx (TS preset, npm)           | Task pipeline, module boundary enforcement                                                     |
| SQL adapter (current) | @mantlejs/knex via Knex.js    | Query builder not ORM — keeps infra layer thin; additional adapters (e.g. Prisma) can be added |
| Password hashing      | @node-rs/argon2 (Argon2id)    | OWASP recommended; no 72-char bcrypt limit                                                     |
| Testing               | Vitest                        | Faster than Jest, native ESM, Jest-compatible API                                              |
| HTTP transport (P1)   | @mantlejs/express via Express | Phase 1 adapter; transport layer is pluggable                                                  |
| Bundler               | tsc                           | Emits .d.ts natively — critical for TS-first libraries                                         |
