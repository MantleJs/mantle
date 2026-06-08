# Mantle JS

A full-stack, tech-agnostic JavaScript/TypeScript framework for building real-time applications and scalable web APIs. Follows Clean Architecture principles — the Application Layer sits between the database core and the UI, like the geological mantle.

**Key differentiator from FeathersJS:** `Service<T>` is a contract only. Data access lives in `Repository<T>` implementations in the Infrastructure layer — business logic is never coupled to a database.

## Architecture

```
Transport Layer       Express adapter — routes HTTP to services
Application Layer     Service<T> contracts, hook pipeline (a.k.a. THE MANTLE)
Domain Layer (Core)   Entities, Repository<T> interfaces
Infrastructure        KnexRepository — implements Domain interfaces
```

Dependencies always point inward. Nothing in Domain or Application layers knows about HTTP or databases.

## Packages

| Package                | Description                                                                |
| ---------------------- | -------------------------------------------------------------------------- |
| `@mantlejs/core`       | Framework kernel — Service, Repository, hooks, errors. Zero external deps. |
| `@mantlejs/express`    | Express HTTP transport adapter                                             |
| `@mantlejs/postgresql` | PostgreSQL adapter via Knex.js                                             |
| `@mantlejs/auth`       | JWT engine + strategy runner                                               |
| `@mantlejs/auth-local` | Local email+password strategy (Argon2id)                                   |
| `@mantlejs/upload`     | File upload via busboy, local disk storage                                 |

## Quick Start

```typescript
import { mantle } from "@mantlejs/core";
import { express } from "@mantlejs/express";
import { postgresql } from "@mantlejs/postgresql";
import { auth, authenticate, sanitizeUser } from "@mantlejs/auth";
import { localStrategy, hashPassword } from "@mantlejs/auth-local";

const app = mantle()
  .configure(express())
  .configure(postgresql({ connection: process.env.DATABASE_URL }))
  .configure(auth({ secret: process.env.JWT_SECRET! }))
  .configure(localStrategy());

app.use("/users", new UserService(new UserRepository(app)), {
  methods: ["find", "get", "create", "update", "patch", "remove"],
});

app.service("users").hooks({
  before: {
    create: [hashPassword()],
    all: [authenticate("jwt")],
  },
  after: { all: [sanitizeUser()] },
  error: { all: [logError()] },
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

| Decision         | Choice                     | Reason                                                 |
| ---------------- | -------------------------- | ------------------------------------------------------ |
| Monorepo         | Nx (TS preset, npm)        | Task pipeline, module boundary enforcement             |
| DB adapter       | Knex.js                    | Query builder not ORM — keeps infra layer thin         |
| Password hashing | @node-rs/argon2 (Argon2id) | OWASP recommended; no 72-char bcrypt limit             |
| Testing          | Vitest                     | Faster than Jest, native ESM, Jest-compatible API      |
| Transport        | Express                    | Most familiar; AI-legible                              |
| Bundler          | tsc                        | Emits .d.ts natively — critical for TS-first libraries |
