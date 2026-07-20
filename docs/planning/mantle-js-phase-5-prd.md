# Mantle JS — Phase 5 PRD: Release Readiness

**Status:** Draft
**Date:** 2026-07-18

---

## Contents

1. [Overview](#overview)
2. [Goals & Non-Goals](#goals--non-goals)
3. [Delivery Sequence](#delivery-sequence)
4. [Phase 5 Specifications](#phase-5-specifications)
5. [Canonical Example](#canonical-example)
6. [Release Plan](#release-plan)
7. [Package Structure Additions](#package-structure-additions)
8. [Success Metrics](#success-metrics)
9. [Architectural & Design Decisions](#architectural--design-decisions)

---

## Overview

Phase 4 completed the client-side story (client SDK, React hooks, MongoDB, OpenAPI, batch, CORS, storage
read/delete) but deliberately did **not** publish: the first npm release (Phase 4 item 8) was moved here so it
ships *after* the release-readiness work, not before it. Phase 5 is the release phase — its deliverable is
Mantle on the public npm registry, provably working end to end, with a canonical example that exercises nearly
every package.

Phase 5 delivers:

1. **`@mantlejs/mcp`** — expose Mantle services as MCP tools, so AI agents are first-class API consumers
   (carried over from the pre-restructure Phase 5 checklist)
2. **`@mantlejs/auth-apple`** — Sign in with Apple strategy over the `@mantlejs/auth-oauth` base
3. **`@mantlejs/auth-microsoft`** — Microsoft Entra ID (personal + work/school accounts) strategy
   *(Facebook was requested for this phase but already shipped in Phase 3 as `@mantlejs/auth-facebook` — no work needed)*
4. **`@mantlejs/auth-linkedin`** — LinkedIn sign-in strategy (OpenID Connect)
5. **Production-ready logging** — harden `@mantlejs/logger` (redaction, child loggers, level configuration,
   deployment guidance) and add an optional LogLayer adapter alongside the pino adapter
6. **Multi-repository services** — verify and document that services can compose more than one repository,
   including across different adapters; clarify transaction semantics
7. **CLI + `create-mantle` verification** — prove the scaffolding path works end to end against the packages
   actually being released, with templates updated through Phase 4/5 features
8. **Canonical example + starter examples** — a full-featured team knowledge base showcasing (nearly) every
   package, plus two small focused examples
9. **First npm release** — the curated package set published to the public npm registry (moved from Phase 4
   item 8): all core libraries **and `@mantlejs/mcp`** at `0.1.0`, newest adapters at `0.1.0-experimental`

Phase 5 package summary:

| Package | Purpose |
| --- | --- |
| `@mantlejs/mcp` | MCP server over registered services — every method a tool, full hook pipeline |
| `@mantlejs/auth-apple` | Sign in with Apple (ES256 client-secret JWT, `form_post` callback) |
| `@mantlejs/auth-microsoft` | Microsoft Entra ID sign-in (PKCE, tenant-configurable) |
| `@mantlejs/auth-linkedin` | LinkedIn sign-in (OpenID Connect) |
| `@mantlejs/logger` (additions) | Redaction, child loggers, `createLogger` factory, LogLayer adapter |
| `@mantlejs/auth-oauth` (additions) | `callbackMethod: "POST"` support for `form_post` providers |
| `examples/*` | Canonical knowledge-base example + minimal starters (not published to npm) |

---

## Goals & Non-Goals

### Goals

- Ship `@mantlejs/mcp` — every registered service method becomes an MCP tool routed through `service.dispatch()`
  (full hook pipeline — auth, validation, events — no bypass path), with input schemas derived from
  `ServiceHandle.describe()`
- Ship `@mantlejs/auth-apple`, `@mantlejs/auth-microsoft`, and `@mantlejs/auth-linkedin` following the
  established Arctic-based strategy pattern (`@mantlejs/auth-google` precedent), completing the "big six"
  OAuth providers (Google, GitHub, Facebook, Apple, Microsoft, LinkedIn)
- Make `@mantlejs/logger` production-ready: field redaction, child/scoped loggers, level configuration via
  `@mantlejs/config`, an out-of-the-box `createLogger()` factory, Cloud Run / GCP structured-logging guidance,
  and a `loglayerAdapter` so LogLayer users get Mantle logging with any of LogLayer's transports
- Verify multi-repository service composition with an executable spec and a documented pattern (including
  cross-adapter composition and `withTransaction` boundaries)
- Verify `@mantlejs/cli` and `create-mantle` produce a working project against the released package set —
  scaffold → install → build → test → run, exercised in CI
- Build the canonical example (team knowledge base with AI-powered semantic search) plus two minimal starters,
  and use them as the release's end-to-end smoke tests
- Publish the first public npm release: all core libraries at `0.1.0`, newest adapters tagged
  `0.1.0-experimental`, in dependency order, with install verification

### Non-Goals (Phase 5)

- No Mantle UI library — the canonical example uses shadcn/ui directly; the Mantle UI library
  (Supabase-UI-style blocks) is Phase 6, where the example gets retrofitted as its first consumer
  (see [Phase 6 backlog](./mantle-js-phase-6-backlog.md) item 4)
- No website — mantlejs.org is Phase 6; Phase 5's documentation deliverable is complete package READMEs
- No `KnexTimeSeriesRepository`, no `@mantlejs/arangodb` — moved to the
  [Phase 6 backlog](./mantle-js-phase-6-backlog.md) (items 1–2)
- No GraphQL transport, rate limiting, multi-tenancy primitives, Vue composables, Neptune/Cosmos adapters —
  still deferred (Phase 6 backlog item 5)
- No replacement of the Mantle `Logger` contract with LogLayer — LogLayer is supported *via adapter*, not
  adopted as a load-bearing dependency (see [Decisions](#architectural--design-decisions) #2)
- No new `Service`/`Repository` API for multi-repository composition — the existing contract already supports
  it; Phase 5 verifies and documents rather than changes

---

## Delivery Sequence

Phase 5 runs in four stages, strictly ordered — the release is last:

1. **Develop packages** — `@mantlejs/mcp`, `@mantlejs/auth-apple`, `@mantlejs/auth-microsoft`,
   `@mantlejs/auth-linkedin`, logger hardening, `auth-oauth` `form_post` support, multi-repository
   verification spec
2. **Release plan finalization** — confirm the publish-tier split against actual coverage, npm org readiness,
   versioning/publish tooling, README audit, CLI/`create-mantle` template updates
3. **Examples** — canonical knowledge-base example + two starters, built against the workspace packages;
   these double as end-to-end verification of stage 1 and the CLI path
4. **Release** — publish in dependency order, then re-verify the examples and `create-mantle` against the
   *published* registry packages (not workspace links)

---

## Phase 5 Specifications

### `@mantlejs/mcp`

Carried over unchanged in intent from the pre-restructure Phase 5 checklist item 1 (review §6.3).

New package, depends only on `@mantlejs/mantle` (consistent with the dependency matrix) plus the
`@modelcontextprotocol/sdk`. `mcp(options)` configure plugin builds an MCP server from the app's registered
services: each service method becomes one tool (`users_find`, `users_get`, `users_create`, …), generated from
`ServiceHandle.describe()` — input schemas from the service's TypeBox schema plus a `QueryParams` schema
constrained to `describe().capabilities.operators` (so an agent is never offered an operator the adapter
rejects), tool descriptions from the descriptor, service events optionally exposed as MCP resources.

**Every call routes through `service.dispatch()`** so the full hook pipeline (auth, validation, events)
applies — no bypass path.

Options: `services?: string[]` allowlist (default: all), `transport: "stdio" | "http"` (streamable HTTP mounted
on the app's transport via the `http:router` contract). Auth for HTTP transport: reuse `authenticate("jwt")`
semantics — bearer token on the MCP request populates `params.user` for hooks. Errors return the
`MantleError.toJSON()` shape including `hint` as MCP tool errors, not protocol errors.

**Acceptance:** an app with two services (one schema'd `RepositoryService` over memory, one custom) lists the
expected tool set with correct input schemas; a `find` tool call with an unsupported operator returns a tool
error naming the operator; a hook that throws `Forbidden` surfaces as a tool error, proving the pipeline ran.

### `@mantlejs/auth-apple`

Sign in with Apple strategy following the `@mantlejs/auth-google` precedent: a thin `OAuthProvider` over
Arctic, all shared flow (state, PKCE where applicable, find-or-create) delegated to `@mantlejs/auth-oauth`.

Apple differs from the shipped providers in three load-bearing ways:

1. **No static client secret.** Apple requires a short-lived ES256-signed JWT as `client_secret`, built from a
   team ID, key ID, and a PKCS#8 private key (Arctic's `Apple` client handles signing). Config is therefore
   `AppleStrategyConfig` = `OAuthPluginConfig` minus `clientSecret`, plus `teamId`, `keyId`, `privateKey`.
2. **`form_post` callback.** When any scope (`name`, `email`) is requested, Apple requires
   `response_mode=form_post` — the callback arrives as a POST with a form-encoded body, not a GET with query
   params. This needs a small **additive** extension to `@mantlejs/auth-oauth`:
   `OAuthProvider.callbackMethod?: "GET" | "POST"` (default `"GET"`), with `createOAuthPlugin` registering
   `router.post(callbackPath)` and reading `code`/`state` from the parsed body when set to `"POST"`.
3. **No userinfo endpoint.** The profile comes from the `id_token` returned by the token exchange (`sub`,
   `email`); the user's name is only delivered once, in the `user` field of the first `form_post` callback.

**Acceptance:** provider unit specs (auth URL shape incl. `response_mode=form_post`; code exchange returning the
id_token; profile extraction from a stubbed id_token; missing `sub` → `GeneralError`); `auth-oauth` specs for the
POST callback path (state validation, error passthrough) proving GET providers are untouched.

### `@mantlejs/auth-microsoft`

Microsoft Entra ID strategy (personal Microsoft accounts + work/school accounts) following the same pattern.
Arctic's `MicrosoftEntraId` client; PKCE enabled; `tenant` configurable (default `"common"` — both account
types); profile from the OIDC userinfo endpoint (`https://graph.microsoft.com/oidc/userinfo`); standard GET
callback; `entityIdField` defaults to `"microsoftId"`.

**Acceptance:** provider unit specs mirroring the Google strategy's (auth URL, PKCE verifier passthrough, code
exchange failure → `GeneralError`, profile normalization from stubbed userinfo, missing `sub` → error);
tenant default and override specs.

### `@mantlejs/auth-linkedin`

LinkedIn sign-in strategy over the same pattern, using LinkedIn's OpenID Connect flow ("Sign In with LinkedIn
using OpenID Connect" product on the LinkedIn developer app — the legacy `r_liteprofile`/v2 profile API is not
used). Arctic's `LinkedIn` client; no PKCE (confidential-client flow — CSRF protection is the `state`
round-trip, as with GitHub/Facebook); scopes `["openid", "profile", "email"]`; profile from
`https://api.linkedin.com/v2/userinfo` (`sub`/`email`/`name`); standard GET callback; `entityIdField` defaults
to `"linkedinId"`. Config is plain `OAuthPluginConfig` — no provider-specific fields.

**Acceptance:** provider unit specs mirroring the Google/Microsoft strategies' (auth URL construction, code
exchange failure → `GeneralError`, userinfo normalization, missing `sub` → error).

### `@mantlejs/logger` — production readiness

Current state: Mantle core defines the `Logger` contract (`debug`/`info`/`warn`/`error`), and
`@mantlejs/logger` ships a `logger()` plugin, `pinoAdapter`, and `logRequest`/`logError` hooks. That's a sound
skeleton but not production-ready. Phase 5 closes the gaps **without changing the contract's ownership** — the
duck-typed `Logger` interface in `@mantlejs/mantle` remains the only thing the framework knows about.

Additions:

- **`createLogger(options)` factory** — out-of-the-box pino-backed logger so apps don't hand-assemble pino:
  `level` (env-aware via `@mantlejs/config` conventions, default `info` in production, `debug` otherwise),
  `redact` (pino redact paths, with Mantle-aware defaults: `password`, `*.password`, `*.accessToken`,
  `*.refreshToken`, `authorization` headers), `pretty` (dev-only pretty printing), `gcp` (Cloud Run /
  Google Cloud Logging structured output: `severity` level labels, `message` key) — pino becomes an optional
  dependency used by this factory and `pinoAdapter`
- **Child loggers** — additive optional `child?(bindings: Record<string, unknown>): Logger` on the core
  `Logger` interface; `pinoAdapter` implements it via `pino.child()`; `logRequest`/`logError` keep working
  against loggers that don't implement it
- **Redaction in hooks** — `logRequest({ includeParams: true })` gains a `redactParams?: string[]` option
  (defaults to the same sensitive-field list) so opting into params logging doesn't leak credentials
- **`loglayerAdapter(log)`** — adapter for a [LogLayer](https://loglayer.dev/) instance satisfying the Mantle
  `Logger` contract (metadata via `withMetadata(...).info(msg)` calls), giving users LogLayer's transport and
  plugin ecosystem without Mantle depending on it; documented as an alternative to `pinoAdapter`
- **Deployment guidance** — README section covering: Cloud Run structured logging, level configuration by
  environment, process-level `uncaughtException`/`unhandledRejection` logging, and log-based metrics on the
  `component` field (`mantle:request`, `mantle:error`)

**Acceptance:** `createLogger` specs (level resolution, redaction of the default sensitive paths, GCP field
mapping); `child()` spec propagating bindings; `loglayerAdapter` spec against a stubbed LogLayer; existing
hook specs stay green.

### Multi-repository services — verification

`Service<T>` is a plain contract, so a custom service can already inject any number of repositories;
`RepositoryService` wraps exactly one *by design*. Phase 5 makes this explicit and proven rather than implied:

- **Executable spec** in `@mantlejs/mantle`: a custom service composing two `Repository<T>` instances
  (e.g. an `articles` service reading from an articles repository and writing an entry to an activity-log
  repository on `create`), registered via `app.use`, full hook pipeline, both repositories over
  `@mantlejs/memory`
- **Cross-adapter documentation**: the same pattern with repositories from *different* adapters (e.g. Knex +
  MongoDB) — supported for reads/writes, with the explicit caveat that `withTransaction()` scopes to a single
  adapter's connection: two Knex repositories on the same instance can share a transaction; a Knex + Mongo
  pair cannot (no distributed transactions — consistent with the Phase 4 batch-atomicity decision)
- **Canonical-example usage**: at least one service in the knowledge-base example composes two repositories
  (see [Canonical Example](#canonical-example)), so the pattern is demonstrated in real code, not just specs

**Acceptance:** the composition spec passes; docs section lands in the root README (or `docs/`) and the
`RepositoryService` API docs cross-reference it ("need two repositories? write a custom service — like this").

### CLI + `create-mantle` verification

`@mantlejs/cli` (`new`, `generate` service/hook/repository/migration/authentication, `add`) and
`create-mantle` exist but predate Phase 4's packages and the release. Phase 5 makes "scaffolding works" a
verified claim:

- Update templates/generators to the current package surface (e.g. offer `@mantlejs/mongodb` as a database
  choice, `cors` option on transports, current auth strategy list including Apple/Microsoft)
- End-to-end smoke test in CI: `create-mantle` scaffold → install (workspace-linked pre-release, registry
  post-release) → `nx build`/`test` inside the scaffold → boot the app → hit a CRUD endpoint → clean exit
- Fix whatever that smoke test flushes out; no new CLI features beyond template updates

**Acceptance:** the CI smoke job is green; a human-run `npm create mantle my-app` against the published
registry produces a working app (post-release gate).

---

## Canonical Example

**`examples/knowledge-base` — "Mantle KB":** a team knowledge base with AI-powered semantic search. One
deliberately over-featured application whose job is to exercise (nearly) every published package in real code —
it is simultaneously the flagship demo, the integration test for the release, and the seed content for the
Phase 6 website.

| Capability | Packages exercised |
| --- | --- |
| API kernel, hooks, typed errors, batch | `@mantlejs/mantle` |
| HTTP transport + CORS | `@mantlejs/express` |
| Persistence (Postgres) | `@mantlejs/knex` |
| Semantic search over articles (pgvector) | `@mantlejs/knex` (`KnexVectorRepository`) |
| Auth: email+password, Google, GitHub, Apple, Microsoft, LinkedIn | `@mantlejs/auth`, `auth-local`, `auth-oauth`, `auth-google`, `auth-github`, `auth-apple`, `auth-microsoft`, `auth-linkedin` |
| Refresh-token + OAuth state across instances | `@mantlejs/auth-redis` |
| File attachments (disk in dev, S3 or GCS in prod) | `@mantlejs/storage`, `storage-s3`, `storage-gcs` |
| Validation + field resolution | `@mantlejs/schema` |
| Real-time updates (article edits, comments, presence) | `@mantlejs/socketio`, `@mantlejs/sync` (Redis) |
| Structured logging (prod-ready config) | `@mantlejs/logger` |
| Environment config | `@mantlejs/config` |
| API docs | `@mantlejs/openapi` (spec + Swagger UI) |
| AI-agent access (search/read/create articles as MCP tools) | `@mantlejs/mcp` |
| Web frontend (Vite + React + shadcn/ui) | `@mantlejs/client`, `@mantlejs/react` |
| Tests-as-prototype (in-memory repositories in specs) | `@mantlejs/memory` |

Domain: `users`, `articles` (versioned markdown docs), `comments`, `attachments`, `search` (vector similarity
over article embeddings). The `articles` service is the multi-repository showcase: it composes the article
repository with an activity-log repository (and the vector repository for embedding upserts), demonstrating the
verified multi-repo pattern.

Not exercised (and that's fine): `@mantlejs/koa`/`@mantlejs/http` (Express is the canonical transport; the
starters cover `http`), `dynamodb`/`supabase`/`pinecone`/`qdrant`/`neo4j`/`mongodb` (the knowledge base
runs on Postgres; adapter READMEs own their own examples).

**Starter examples** (small, single-purpose):

- `examples/todo-minimal` — `@mantlejs/http` + `@mantlejs/memory`, zero external services, < 100 lines: the
  "hello world" for READMEs and the website
- `examples/realtime-chat` — Express + Socket.IO + knex/sqlite + local auth + `@mantlejs/client` in a bare
  HTML page: the real-time quick start

Examples live in the monorepo under `examples/` (not `packages/`), are **not published to npm**, are excluded
from the release, and run against workspace packages pre-release / registry packages in the post-release
verification pass.

---

## Release Plan

Moved from Phase 4 item 8, expanded into a staged plan. **The user-facing commitment: all core libraries are
released.** Tiering only distinguishes stable from experimental confidence — nothing is withheld.

### Tiering (working split — finalized at stage 2, not planning time)

Per the [Phase 4 Publish Tiering decision](./mantle-js-phase-4-prd.md#publish-tiering), which remains in force:

| Tier | Packages |
| --- | --- |
| **Stable `0.1.0`** | `@mantlejs/mantle`, `express`, `koa`, `http`, `knex`, `auth`, `auth-local`, `auth-oauth`, `auth-google`, `auth-github`, `auth-facebook`, **`auth-apple`**, **`auth-microsoft`**, **`auth-linkedin`**, `auth-redis`, `storage`, `storage-s3`, `storage-gcs`, `logger`, `schema`, `memory`, `config`, `socketio`, `supabase`, `sync`, **`mcp`**, `client`, `react`, `cli`, `create-mantle` |
| **`0.1.0-experimental`** | `@mantlejs/dynamodb`, `pinecone`, `qdrant`, `neo4j`, `mongodb`, `openapi` |

`auth-apple`/`auth-microsoft`/`auth-linkedin` join the stable tier despite being new this phase: they are thin
strategies over the battle-tested `auth-oauth` base, matching the other auth strategies already in stable.
`@mantlejs/mcp` also ships **stable — it is a release requirement**, a deliberate exception to the standing
"no substantial new package goes straight to stable in the phase it's introduced" rule (see
[Decisions](#architectural--design-decisions) #12): agent access is the headline differentiator of this
release, and it earns stable status through flagship-level acceptance specs plus end-to-end exercise in the
canonical example before publish.

### Stages

1. **Pre-flight (stage 2 of the delivery sequence)**
   - `npx nx run-many -t build,test,lint,typecheck` fully green
   - Every `package.json`: `"publishConfig": { "access": "public" }`, correct `exports`/`main`/`module`/`types`,
     `"files": ["dist"]`, aligned `peerDependencies` ranges, repository/homepage/license fields
   - README audit: every published package has installation, quick start, and API reference at minimum
   - **Finalize the tier list** — dedicated review of the split above against actual coverage; not a rubber stamp
   - npm org (`@mantlejs`) access, 2FA, granular automation token for CI publish, provenance enabled
   - Choose and wire the publish tooling (`nx release` — see Decisions #7)
2. **Example verification (stage 3)** — canonical example + starters green against workspace packages;
   CLI smoke test green
3. **Publish (stage 4)** — dependency order:
   `@mantlejs/mantle` → `schema`/`memory`/`config`/`logger` → transports (`express`, `koa`, `http`,
   `socketio`) → database adapters (incl. `mongodb`) → `auth` → `auth-oauth` → auth strategies (incl.
   `apple`/`microsoft`/`linkedin`) → `auth-redis` → `storage*` → `sync` → `openapi` → `mcp` → `client` →
   `react` → `cli` → `create-mantle`
4. **Post-release verification**
   - `npm install @mantlejs/<name>` resolves from an empty project for every published package
   - `npm create mantle my-app` against the live registry produces a working app
   - Re-point one example at registry versions and confirm it boots and passes its smoke flow
   - Tag the repo (`v0.1.0`), publish GitHub release notes

---

## Package Structure Additions

```text
mantle/
├── packages/
│   ├── [all Phase 1–4 packages]
│   ├── mcp/              @mantlejs/mcp            [NEW P5]
│   ├── auth-apple/       @mantlejs/auth-apple     [NEW P5]
│   ├── auth-microsoft/   @mantlejs/auth-microsoft [NEW P5]
│   └── auth-linkedin/    @mantlejs/auth-linkedin  [NEW P5]
├── examples/                                      [NEW P5 — not published]
│   ├── knowledge-base/
│   ├── todo-minimal/
│   └── realtime-chat/
```

### Updated Package Dependency Rules (Phase 5 additions)

| Package | May depend on |
| --- | --- |
| `@mantlejs/mcp` | `@mantlejs/mantle` (+ `@modelcontextprotocol/sdk`) |
| `@mantlejs/auth-apple` | `@mantlejs/mantle`, `@mantlejs/auth-oauth` |
| `@mantlejs/auth-microsoft` | `@mantlejs/mantle`, `@mantlejs/auth-oauth` |
| `@mantlejs/auth-linkedin` | `@mantlejs/mantle`, `@mantlejs/auth-oauth` |
| `examples/*` | anything (apps, not libraries — exempt from library boundary rules, never depended on) |

`CLAUDE.md`'s dependency matrix and the root README packages table are updated when these land.

---

## Success Metrics

- All stable-tier packages installable from the public registry and importable in a fresh project
- `npm create mantle my-app` → working app in under five minutes, against the live registry
- Canonical example runs locally with `docker compose up` (Postgres+pgvector, Redis) + `nx serve`, and every
  feature row in the table above is demonstrably exercised
- An MCP-capable agent (e.g. Claude) can list and call knowledge-base tools through `@mantlejs/mcp`, and a
  `Forbidden` from a hook surfaces as a tool error — proving agents go through the same pipeline as humans
- Zero secrets in logs when running the canonical example with `includeParams: true` (redaction verified)
- `npx nx run-many -t build,test,lint,typecheck` green across the workspace, including examples

---

## Architectural & Design Decisions

| # | Question | Decision |
| --- | --- | --- |
| 1 | Adopt [LogLayer](https://loglayer.dev/) for logging? | **No as a core dependency; yes as an adapter.** Mantle core already owns a minimal duck-typed `Logger` contract, and LogLayer is itself a transport-abstraction layer — adopting it wholesale stacks an abstraction on an abstraction and violates the zero-dep kernel stance. The production gaps (redaction, child loggers, level config, deployment guidance) are Mantle's to close regardless of backend. A ~30-line `loglayerAdapter` gives LogLayer users full access without coupling. |
| 2 | Is current logging production-ready? | **Not yet — hardening is in scope.** Gaps identified: no redaction (only an `includeParams: false` default), no child/scoped loggers, no level-configuration story, no out-of-the-box logger construction, no structured-logging deployment guidance. All addressed in the `@mantlejs/logger` spec above; the `Logger` contract itself is sound and unchanged (one additive optional `child?()`). |
| 3 | Mantle UI library now (for the example) or Phase 6? | **Phase 6.** The canonical example uses shadcn/ui — the same foundation Supabase UI builds on — so the example ships now and gets retrofitted as the UI library's first consumer later. Building a UI library before the first npm release inverts priorities. |
| 4 | Keep `KnexTimeSeriesRepository` / `@mantlejs/arangodb` in Phase 5? | **No — moved to the Phase 6 backlog.** Neither is needed by the canonical example or the release; Phase 5 stays focused on release readiness. |
| 5 | Canonical example domain? | **Team knowledge base with AI-powered semantic search.** Chosen over a kanban tracker or chat app because it naturally exercises the differentiating packages — vector search, MCP, storage, OAuth breadth, real-time — in one coherent product, and it's honest content for the Phase 6 website. |
| 6 | Publish tooling? | **`nx release`.** The workspace is already Nx; `nx release` handles versioning, dependency-ordered publishing, and changelogs without adding Changesets or Lerna. Configuration details in the TDD. |
| 7 | Examples in-repo or separate repos? | **In-repo under `examples/`, unpublished.** They must build in CI against workspace packages to serve as release verification; separate repos would rot. Website-facing copies can be split out in Phase 6 if needed. |
| 8 | Apple `form_post` — new package-level flow or extend `auth-oauth`? | **Additive `OAuthProvider.callbackMethod` in `auth-oauth`.** Default `"GET"` keeps every shipped provider byte-for-byte compatible; Apple opts into `"POST"`. A parallel flow implementation in `auth-apple` would duplicate state/PKCE/find-or-create logic the base package exists to own. |
| 9 | Multi-repository services — new abstraction? | **No.** The `Service` contract already supports arbitrary repository composition in custom services; `RepositoryService` staying 1:1 is a feature (it's the trivial bridge, not the ceiling). Phase 5 ships proof (spec), documentation, and a real usage in the canonical example. Cross-adapter transactions are explicitly out — same reasoning as Phase 4's batch-atomicity decision. |
| 10 | Where does the release live in the sequence? | **Last.** Packages → release plan → examples → publish. The examples and CLI smoke tests are the release gate; publishing before them (the Phase 4 ordering) would have shipped unverified packages — that's why item 8 moved here. |
| 11 | `@mantlejs/mcp` — stable or experimental at first release? | **Stable `0.1.0` — it is a release requirement.** A deliberate exception (2026-07-19) to the "no new package goes straight to stable in its introduction phase" rule: agent access via MCP is the headline differentiator of the first release, and tagging it experimental would undercut that story. Compensating controls: the acceptance specs prove the full hook pipeline runs under MCP, and the canonical example exercises the server end to end (including a real agent tool call) before publish. |

---

## Reference

- [Phase 5 TDD](./mantle-js-phase5-tdd.md)
- [Phase 5 Checklist](./mantle-js-phase-5-checklist.md)
- [Phase 6 Backlog](./mantle-js-phase-6-backlog.md)
- [Phase 4 PRD](./mantle-js-phase-4-prd.md) — Publish Tiering, batch-atomicity precedent
- [Phase 4 Checklist](./mantle-js-phase-4-checklist.md) — item 8 (moved here)
- [AI-First Architecture Review](./ai-first-architecture-review.md) — §6.3 (`@mantlejs/mcp` rationale)
