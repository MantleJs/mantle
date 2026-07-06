# Product Requirements Document
# Mantle JS — Full-Stack JavaScript/TypeScript Framework

**Version:** 0.1.0-draft  
**Status:** In Review  
**License:** MIT  
**Last Updated:** 2026-05-16

---

## Table of Contents

1. [Overview](#overview)
2. [Background & Motivation](#background--motivation)
3. [Goals & Non-Goals](#goals--non-goals)
4. [Target Audience](#target-audience)
5. [Architecture Philosophy](#architecture-philosophy)
6. [Core Concepts](#core-concepts)
7. [Phase 1 — Specification](#phase-1--specification)
8. [Future Phases (Roadmap)](#future-phases-roadmap)
9. [Package Structure](#package-structure)
10. [Developer Experience Principles](#developer-experience-principles)
11. [Open Source & Licensing](#open-source--licensing)
12. [Success Metrics](#success-metrics)
13. [Architectural & Design Decisions](#architectural--design-decisions)

---

## Overview

**Mantle JS** is a full-stack, tech-agnostic JavaScript/TypeScript framework optimized for building real-time applications and scalable web APIs. Mantle serves as a flexible core layer between the database and the UI — analogous to the geological mantle sitting beneath the crust (the UI layer).

Mantle is designed to be **architecture-first**: it enforces a clean separation of concerns inspired by Clean Architecture and Onion Architecture, rather than coupling business logic to data access or transport concerns. This is the foundational design choice that differentiates Mantle from comparable frameworks such as FeathersJS.

Mantle is built to be approachable by individual developers, startup engineering teams, and AI coding agents alike.

---

## Background & Motivation

### The Problem with Existing Solutions

**FeathersJS** is the closest analog to Mantle. It is a lightweight, real-time capable service framework that has earned a strong following. However, it carries a structural limitation: **services couple business logic directly with data access logic**. A Feathers service is simultaneously a use case, a repository, and a controller. This works well for small applications but becomes a liability at scale, during testing, or when swapping infrastructure.

Other frameworks (NestJS, AdonisJS, Hapi) either impose too much framework opinion on domain code, require significant boilerplate, or are not optimized for real-time delivery.

### Why Mantle

Mantle takes direct inspiration from FeathersJS's ergonomics — the plugin model, adapters, hooks-style middleware — but reimagines the core around a **layered architecture** where:

- Domain logic is independent of infrastructure
- Services define *contracts*, not *implementations*
- Adapters and transports are swappable without touching business logic
- The framework is predictable enough to be scaffolded and consumed by AI agents

The name **Mantle** reflects this positioning: the framework occupies the service layer — the geological mantle — between the database (the core) and the UI (the crust). It is the layer that everything flows through, but it is never the outermost surface.

---

## Goals & Non-Goals

### Goals

- Provide a clean, layered architectural foundation for JavaScript/TypeScript APIs
- Be tech-agnostic: no lock-in to a specific database, ORM, HTTP server, or frontend
- Support real-time delivery natively (starting with REST, expanding to WebSockets)
- Ship a minimal but fully functional Phase 1 that developers can build production apps with
- Be predictable and well-structured enough for AI agents to generate correct Mantle code
- Be open source, MIT licensed, and community extensible via a first-party plugin interface

### Non-Goals (All Phases)

- Mantle is **not** a full-stack meta-framework — it does not server-render HTML, does not use the filesystem to define routes, and does not render frontend components. Mantle outputs data (JSON, events), not pages. Any frontend — React, Vue, iOS, Android — consumes it equally.
- Mantle is **not** an ORM — it wraps and adapts existing ORMs/query builders
- Mantle is **not** opinionated about your frontend — it delivers data, you choose the UI
- Mantle will **not** attempt to replicate Next.js, Nuxt, or Remix feature sets

### Non-Goals (Phase 1 Specifically)

- No GraphQL transport
- No WebSocket/SSE transport
- No multi-tenancy primitives
- No queue or job system
- No OAuth / social auth (local/password auth only)

---

## Target Audience

### Primary

| Persona | Description |
| --- | --- |
| **Indie Developer** | Solo builder shipping a SaaS, API, or side project. Wants structure without ceremony. Familiar with Node.js and one major framework. |
| **Startup Engineering Team** | Small team (2–8 engineers) building an API-first product. Needs conventions that scale as the codebase grows, and an easy onboarding story for new hires. |
| **AI Coding Agent** | Claude, Gemini, GPT-4o, or similar agent building or scaffolding backend code on behalf of a developer. Requires consistent, well-documented patterns and clear separation of concerns. |

### Secondary

- Backend engineers evaluating FeathersJS alternatives
- Google Cloud / Firebase developers looking for a more structured API layer
- Developers migrating from monoliths to service-oriented architecture

---

## Architecture Philosophy

### The Core Differentiator: Clean / Onion Architecture

FeathersJS couples the **service layer** with the **data access layer**. A Feathers service implements both "what should happen" (use case) and "how data is fetched" (repository) in the same class.

Mantle separates these concerns using a **layered architecture** informed by both Clean Architecture (Robert C. Martin) and Onion Architecture (Jeffrey Palermo).

### Mantle Layer Model

```
                  ┌─────────────────────────────────────────────────────┐
                  │                     CRUST (UI)                      │
                  │          React, Vue, Angular, iOS, Android          │
                  └───────────────────────┬─────────────────────────────┘
                                          │  HTTP / WebSocket / SSE
                  ┌───────────────────────▼─────────────────────────────┐
                  │              TRANSPORT LAYER                         │
                  │         Express / Koa / Raw HTTP adapters           │
                  │                  Routes / Controllers               │
                  └───────────────────────┬─────────────────────────────┘
                                          │
┌─────────────────┬───────────────────────▼─────────────────────────────┐
│                 │           APPLICATION LAYER          ← THE MANTLE    │
│  Infrastructure │    Use Cases / Service Interfaces (Contracts)        │
│  (outer layer)  │    Hooks / Middleware Pipeline                       │
│                 │    Auth Guards / Validation                          │
│  Implements     └───────────────────────┬─────────────────────────────┘
│  interfaces                             │
│  defined by  ┌──────────────────────────▼──────────────────────────┐  │
│  inner layers│               DOMAIN LAYER (CORE)                   │  │
│              │          Entities / Business Rules                   │  │
└──────────────│          Repository Interfaces (abstractions)        │──┘
   depends on →└─────────────────────────────────────────────────────┘
                                    ▲  ▲
               ┌────────────────────┘  └──────────────────────┐
               │  Infrastructure implements these interfaces   │
               │  Database Adapters, ORM integrations,         │
               │  External Service Adapters                    │
               └───────────────────────────────────────────────┘
```

> **Reading the diagram:** Arrows represent dependency direction, not call order. Infrastructure (the outer layer) depends on and implements interfaces defined by the Domain (the inner core). The Application Layer — the **Mantle** — is where service contracts, use cases, and the hook pipeline live. The Transport Layer (crust-facing) calls into the Application Layer. Nothing in the Domain or Application layers knows about the database or HTTP.

### Key Architectural Rules

1. **Dependency Rule**: Dependencies always point inward. Infrastructure (outer layer) depends on and implements Domain interfaces. Application depends on Domain. Transport depends on Application. Nothing in the Domain or Application layers knows about the database or HTTP transport — these are outer-layer concerns.

2. **Service Contracts**: A Mantle "Service" is an interface (contract), not a class. It defines the operations (find, get, create, update, patch, remove) that a use case must implement. This mirrors FeathersJS vocabulary but decouples it from the implementation.

3. **Repository Pattern**: Data access is abstracted behind repository interfaces defined in the Domain layer. Database adapters in the Infrastructure layer implement these interfaces.

4. **Hook Pipeline**: Inspired by FeathersJS hooks, the middleware pipeline (before/after/error) operates at the Application layer, not at the transport level. This means hooks are transport-agnostic.

5. **Simplified Phase 1**: For Phase 1, the Application layer and Domain layer may be **co-located** as a single "Service + Domain" layer, acknowledging that full separation is aspirational for small apps. The architecture is designed to be **progressively adoptable**.

### Comparison: FeathersJS vs Mantle

| Concern | FeathersJS | Mantle JS |
| --- | --- | --- |
| Service definition | Class implementing data + logic | Interface (contract) only |
| Data access | Inside the service via adapter | Repository in Infrastructure layer |
| Business logic | Mixed into service methods | Isolated in Application / Domain |
| Hooks | Transport-aware | Transport-agnostic |
| Swapping databases | Requires service changes | Swap adapter only |
| Testability | Requires mocking transport | Domain testable with no mocks |
| AI scaffoldability | Moderate | High (clear boundaries) |

---

## Core Concepts

### 1. Application

The top-level Mantle instance. Responsible for registering services, configuring transports, and bootstrapping the application.

```typescript
import { mantle } from '@mantlejs/mantle';
import express from '@mantlejs/express';

const app = mantle().configure(express());
```

### 2. Services

Services are the primary unit of logic in Mantle. A Mantle service is defined as a **typed interface contract** (`Service<T>`) and implemented separately by the developer — unlike FeathersJS, where the service class couples the contract with data access.

Standard service methods mirror FeathersJS for familiarity:

| Method | HTTP Equivalent | Description |
| --- | --- | --- |
| `find(params)` | GET /resource | List / query multiple records |
| `get(id, params)` | GET /resource/:id | Retrieve single record |
| `create(data, params)` | POST /resource | Create a new record |
| `update(id, data, params)` | PUT /resource/:id | Full replace of a record |
| `patch(id, data, params)` | PATCH /resource/:id | Partial update of a record |
| `remove(id, params)` | DELETE /resource/:id | Delete a record |

#### Custom Service Methods

The standard six methods cover the majority of API use cases, but Mantle supports **custom service methods** for domain-specific actions (e.g. `verifyEmail`, `publishPost`, `acceptInvite`). Custom methods must be explicitly registered to be exposed via a transport:

```typescript
class UserService implements Service<User> {
  // Standard methods...
  async verifyEmail(token: string, params: ServiceParams): Promise<User> {
    // custom logic
  }
}

app.use('/users', new UserService(), {
  methods: ['find', 'get', 'create', 'update', 'patch', 'remove', 'verifyEmail']
});
```

Custom methods are exposed as `POST /users/verifyEmail` by default in the REST transport.

### 3. Repositories

Repository interfaces (`Repository<T>`) are defined in the co-located Service/Domain layer. Infrastructure adapters implement them. Services depend on the repository interface, never the concrete adapter.

```typescript
// Co-located with the service — no database knowledge here
interface UserRepository extends Repository<User> {
  findByEmail(email: string): Promise<User | null>;
}
```

### 4. Hooks (Middleware Pipeline)

Hooks run before, after, or on error for any service method. They are pure functions that receive and return a context object. They are transport-agnostic.

```typescript
app.service('users').hooks({
  before: {
    create: [validateSchema, hashPassword],
    all: [authenticate],
  },
  after: {
    find: [sanitizeOutput],
  },
  error: {
    all: [logError],
  }
});
```

### 5. Adapters

Adapters are Infrastructure-layer implementations. Phase 1 ships one database adapter (PostgreSQL) and one transport adapter (Express). Adapters follow a published interface, making community adapters straightforward to build.

### 6. Plugins

The plugin interface allows third-party and first-party packages to configure the Mantle application:

```typescript
app.configure(myPlugin({ option: true }));
```

A plugin is simply a function `(app: MantleApplication) => void | Promise<void>`.

---

## Phase 1 — Specification

### Goals

Deliver a functional, installable, documented, open-source framework that a developer can use to build a real REST API with PostgreSQL persistence and password-based authentication.

### Deliverables

#### @mantlejs/mantle

The framework kernel. Provides:

- `mantle()` factory — application instance
- Service registration: `app.use('/path', service)`
- Service retrieval: `app.service('name')`
- Plugin interface: `app.configure(plugin)`
- Hook pipeline engine (before / after / error)
- Context object (`HookContext`) passed through the pipeline
- Params object (`ServiceParams`) for query, user, provider, headers
- Error classes: `MantleError`, `NotFound`, `BadRequest`, `NotAuthenticated`, `Forbidden`, `GeneralError`
- TypeScript-first with full type inference on hooks and services
- Zero runtime dependencies beyond Node.js built-ins

#### @mantlejs/express

Express transport adapter. Provides:

- `express()` plugin factory
- Automatic REST route binding for registered services
- Standard middleware setup (JSON body parsing, CORS)
- Error handler middleware
- `req` → `params` mapping (query strings, route params, auth context)
- Support for Express middleware injection: `app.use(middleware)`

#### @mantlejs/knex

SQL database adapter using **Knex.js** as the query builder (chosen for its flexibility, wide adoption, and lack of ORM opinion). Supports PostgreSQL (primary), MySQL/MariaDB, SQLite, and MSSQL via a single package. Provides:

- `knex(config)` plugin factory
- Base `KnexRepository<T>` class implementing the Repository interface
- Support for: find (with filtering/pagination), get, create, update, patch, remove
- Full query operator support (`$lt`, `$gt`, `$in`, `$nin`, `$or`, `$and`, `$like`, `$ilike`, etc.)
- Transaction support via `withTransaction()`
- Automatic timestamp management (`createdAt`, `updatedAt`)
- MySQL `RETURNING` fallback (re-fetch after insert/update for databases that lack native `RETURNING`)
- Connection pooling via Knex defaults
- Configurable table name, id field, timestamps

> **Why Knex over Prisma for Phase 1?**  
> Knex is a query builder, not a full ORM. This keeps Mantle's infrastructure layer thin and avoids coupling the framework to a schema migration tool. A `@mantlejs/prisma` adapter can be added in a later phase for developers who prefer Prisma's DX.

#### @mantlejs/auth

The core authentication engine. Provides:

- `auth(config)` plugin factory
- JWT issuance and verification (access token + refresh token)
- `authenticate(...strategies)` hook — protects service methods
- `sanitizeUser` hook — strips sensitive fields from output
- Strategy runner — loads and executes registered auth strategies
- User service interface: pluggable, developer provides the user service/repository
- Configuration: `secret`, `expiresIn`, `entity` (defaults to `'users'`)

#### @mantlejs/auth-local

Local (username/password) authentication strategy. Mirrors the `@feathersjs/authentication-local` pattern. Provides:

- `localStrategy()` plugin — registers the local strategy with `@mantlejs/auth`
- Email + password credential validation
- Password hashing via `bcrypt`
- `hashPassword(field)` hook — hashes a password field before create/update
- Configurable `usernameField` and `passwordField`

> OAuth and social strategies (`@mantlejs/auth-google`, `@mantlejs/auth-github`) are deferred to Phase 2.

#### @mantlejs/storage

File upload handling plugin. Provides:

- `upload(config)` plugin factory
- Multipart form data parsing via `busboy`
- Local disk storage adapter (configurable destination path)
- File size and MIME type validation
- Upload hook: `handleUpload(field, options)` — processes file upload before a service `create` or `patch`
- File metadata (filename, size, mimetype, path) passed through `HookContext` to the service
- Designed for adapter extensibility: cloud storage (S3, GCS) adapters deferred to Phase 2

#### docs.mantlejs.dev *(Phase 1)*

A VitePress-powered documentation site. Phase 1 scope:

- Getting Started guide (install, scaffold, first API in 30 minutes)
- Core Concepts pages (Services, Repositories, Hooks, Plugins, Auth)
- API reference for all Phase 1 packages
- Two full example walkthroughs: basic CRUD API and authenticated API
- Hosted on GitHub Pages or Vercel

#### @mantlejs/cli *(stretch goal for Phase 1)*

A minimal CLI for project scaffolding:

- `mantle new <project-name>` — scaffold a new project
- `mantle generate service <name>` — scaffold a service with contract, implementation, and repository
- Templates generate code compatible with the layered architecture

### Phase 1 Non-Deliverables

The following are **explicitly out of scope** for Phase 1 and must not be implemented or stubbed in ways that create architectural assumptions:

- WebSocket / Socket.io transport
- Server-Sent Events (SSE)
- GraphQL transport
- MongoDB / MySQL / SQLite adapters
- OAuth / social authentication (`@mantlejs/auth-google`, `@mantlejs/auth-github`, etc.)
- Role-based access control (RBAC) primitives
- Job/queue system
- Admin UI or dashboard
- Cloud deployment tooling (Google Cloud, AWS, etc.)

### Phase 1 Technical Constraints

| Constraint | Decision |
| --- | --- |
| Node.js minimum | v18 LTS |
| Language | TypeScript (compiled to ESM + CJS dual output) |
| Module format | ESM-first, CJS interop |
| Testing framework | Vitest |
| Linting | ESLint + Prettier |
| Package manager | npm |
| Monorepo tooling | Nx (TypeScript preset) |
| CI/CD | GitHub Actions |
| Package registry | npm under `@mantlejs` scope |

### Phase 1 Success Criteria

A Phase 1 release is considered complete when a developer can:

1. Install Mantle packages from npm
2. Scaffold a project manually or via CLI
3. Define a service contract and implementation
4. Register a PostgreSQL repository
5. Expose a fully functional REST API via Express
6. Protect routes with JWT-based local authentication
7. Read the documentation and build a working CRUD API within 30 minutes
8. An AI coding agent (e.g., Claude) can generate a correct, runnable Mantle service with no human correction
9. A documentation site is live with Getting Started guide, API reference, and at least two example walkthroughs

---

## Future Phases (Roadmap)

### Phase 2 — Real-Time & Expanded Adapters

- Polished marketing + docs site (mantlejs.dev) with ecosystem showcase, migration guide from FeathersJS, and community section

- WebSocket transport (`@mantlejs/websockets`)
- Server-Sent Events transport (`@mantlejs/sse`)
- Koa HTTP adapter (`@mantlejs/koa`)
- MongoDB adapter (`@mantlejs/mongodb`)
- Prisma adapter (`@mantlejs/prisma`)
- OAuth strategies: `@mantlejs/auth-google`, `@mantlejs/auth-github`
- RBAC hooks and permission primitives
- Cloud storage adapters for `@mantlejs/storage`: S3, Google Cloud Storage

### Phase 3 — Scale & Ecosystem

- Raw HTTP adapter (zero-dependency transport)
- Hono adapter (edge runtime compatible)
- `@mantlejs/channels` — real-time channel/room management
- `@mantlejs/queue` — job queue integration (BullMQ)
- Google Cloud deployment guide and starter template
- React, Vue, Angular client SDKs
- iOS and Android client SDKs (Swift, Kotlin)

### Phase 4 — Enterprise & AI-Native

- Multi-tenancy primitives
- Audit log hooks
- Rate limiting plugin
- OpenAPI / Swagger auto-generation from service contracts
- MCP (Model Context Protocol) server adapter — expose Mantle services as AI tools
- AI agent scaffold mode: structured prompt output for code generation

---

## Package Structure

```text
mantle/
├── packages/
│   ├── core/              # @mantlejs/mantle
│   │   ├── src/
│   │   ├── project.json
│   │   └── package.json
│   ├── express/           # @mantlejs/express
│   │   ├── src/
│   │   ├── project.json
│   │   └── package.json
│   ├── knex/              # @mantlejs/knex
│   │   ├── src/
│   │   ├── project.json
│   │   └── package.json
│   ├── auth/              # @mantlejs/auth
│   │   ├── src/
│   │   ├── project.json
│   │   └── package.json
│   ├── auth-local/        # @mantlejs/auth-local
│   │   ├── src/
│   │   ├── project.json
│   │   └── package.json
│   ├── storage/           # @mantlejs/storage
│   │   ├── src/
│   │   ├── project.json
│   │   └── package.json
│   └── cli/               # @mantlejs/cli (stretch)
│       ├── src/
│       ├── project.json
│       └── package.json
├── examples/
│   ├── basic-rest-api/
│   └── auth-example/
├── docs/                  # Documentation site source
├── .github/
│   └── workflows/
├── nx.json
├── tsconfig.base.json     # Shared TS path aliases (e.g. @mantlejs/mantle)
├── package.json
└── README.md
```

---

## Developer Experience Principles

1. **Familiarity First** — Vocabulary and patterns should feel familiar to FeathersJS developers. Migration should be a learning curve, not a wall.

2. **Progressive Architecture** — Phase 1 allows co-located service + domain. The framework grows with the developer. Advanced Clean Architecture is opt-in, not forced.

3. **TypeScript Without Pain** — Full type inference. No decorators required. No `any` in the public API surface. Types should guide the developer, not fight them.

4. **AI-Legible Code** — Consistent naming, explicit interfaces, and clear layer boundaries make Mantle code easy for AI agents to generate, read, and modify correctly.

5. **Minimal Magic** — No hidden dependency injection containers, no reflection-based wiring, no convention-over-configuration surprises. What you see is what runs.

6. **Testability by Design** — Every layer is independently testable. Services can be unit tested without a database. Repositories can be tested without a transport. Hooks are pure functions.

---

## Open Source & Licensing

- **License**: MIT
- **Repository**: GitHub (`mantlejs/mantle` — organization TBD)
- **Contributions**: Standard open source model — issues, PRs, discussions
- **Governance**: Benevolent dictator for life (BDFL) model for Phase 1; move toward RFC process as community grows
- **Code of Conduct**: Contributor Covenant
- **Package publishing**: npm under `@mantlejs` scope, published via automated GitHub Actions release workflow (triggered by version tags)

---

## Success Metrics

| Metric | Phase 1 Target |
| --- | --- |
| npm weekly downloads | 100+ within 60 days of launch |
| GitHub stars | 250+ within 90 days |
| Time to first working API | < 30 minutes for a developer familiar with Node.js |
| AI agent correctness rate | > 90% — Claude can generate a valid service with no correction |
| Core package test coverage | > 90% |
| Documentation completeness | All public APIs documented with examples |
| Open issues (critical bugs) | 0 at launch |

---

## Architectural & Design Decisions

All Phase 1 open questions have been resolved.

| # | Question | Decision |
| --- | --- | --- |
| 1 | Co-locate Application + Domain or enforce separation from day one? | **Co-locate** for Phase 1. Full layer separation is opt-in as the app grows. |
| 2 | SQL adapter strategy? | **`@mantlejs/knex` is the single SQL adapter for all supported databases** (PostgreSQL, MySQL/MariaDB, SQLite, MSSQL). Knex.js handles dialect differences, keeping adapter maintenance minimal. |
| 3 | Name for the core service interface? | **`Service<T>`** — simple and idiomatic TypeScript. Implementations are named by the developer (e.g. `UserService implements Service<User>`). Repository abstraction follows the same pattern: `Repository<T>`. |
| 4 | Hooks: class-based, function-based, or both? | **Function-based only.** Easier to compose, better tree-shaking, cleaner TypeScript inference, more AI-legible. Mirrors the direction FeathersJS v5 took. |
| 5 | CLI in Phase 1 or defer? | **Stretch goal for Phase 1.** Included if time allows; otherwise deferred to Phase 2. |
| 6 | Google Cloud integration story? | **Cloud Run** is the primary deployment target. Phase 1 ships a `Dockerfile` template and a Cloud Run + Cloud SQL docs guide. Phase 3 adds `@mantlejs/gcp` (Cloud SQL helper, health check hooks, Secret Manager config). |
| 7 | Formal RFC process before Phase 2? | **No.** Governance stays lightweight until community growth warrants it. |
