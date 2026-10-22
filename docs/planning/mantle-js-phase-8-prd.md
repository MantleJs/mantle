# Mantle JS — Phase 8 PRD: Production-Grade API, Agent-Native MCP, Multi-Tenancy, Open-Source Readiness

**Status:** Draft
**Date:** 2026-10-12

---

## Contents

1. [Overview](#overview)
2. [Goals & Non-Goals](#goals--non-goals)
3. [Delivery Sequence](#delivery-sequence)
4. [Phase 8 Specifications](#phase-8-specifications)
5. [Release Plan](#release-plan)
6. [Package Structure Additions](#package-structure-additions)
7. [Success Metrics](#success-metrics)
8. [Architectural & Design Decisions](#architectural--design-decisions)

---

## Overview

Phase 7 shipped code mode, the UI registry, and mantlejs.com. Mantle now has a public face. Phase 8 makes sure
what's behind it holds up under production traffic, under agents that retry, and under more than one customer
per deployment. It has five themes:

1. **Production-grade API (Part A).** The things every serious public API has and Mantle doesn't yet: rate
   limiting, idempotency keys, RFC 9457 Problem Details errors, conditional requests (ETag / `If-Match`), request
   IDs + W3C trace context + OpenTelemetry, and health/readiness endpoints. Today the HTTP transports have CORS and
   a correlation ID and nothing else from this list. Each feature tracks the relevant IETF/W3C standard or the
   current IETF draft, so the behavior is something clients already know how to handle.
2. **Agent-native MCP (Part B).** `@mantlejs/mcp-code` already gives agents programmatic tool calling (`execute`)
   and progressive discovery (`search_api`). Tool mode doesn't: every tool definition is listed up front. Phase 8
   adds a **layered** tool mode (discover → describe → call meta-tools), MCP **tool annotations** derived from the
   service method, idempotency-key passthrough for agent retries, and a test client for app authors.
3. **Multi-tenancy primitives (Part C).** Deferred since Phase 1. Row-level tenant isolation as hooks that work
   on any `Repository<T>`, with tenant resolution from the authenticated principal, tenant-scoped realtime
   channels, and a cross-tenant-leak conformance suite.
4. **Open-source readiness & brand (Part D).** License files (done 2026-10-12, see Decision #1), community
   health files, SBOM, OpenSSF Scorecard, an OWASP ASVS self-assessment of the auth packages, npm homepages
   pointed at mantlejs.com, and a v1 logo with brand tokens applied to the site.
5. **Content process (Part E).** A documented pipeline for blog posts and YouTube videos, with the repo as the
   source of truth and a blog on mantlejs.com. Process and site work only, no package code.

The remaining backlog items move to the [Phase 9 backlog](./mantle-js-phase-9-backlog.md) — see Decisions #2.

---

## Goals & Non-Goals

### Goals

- A transport-neutral way for hooks to set the response status and headers (`context.http`), honored by the
  express, koa, and http transports. Everything in Part A builds on it.
- `@mantlejs/ratelimit`: a `rateLimit()` hook with pluggable stores (memory, Redis), keyed by user, agent, tenant,
  or IP, emitting the IETF `RateLimit` / `RateLimit-Policy` headers and `Retry-After` on 429.
- `@mantlejs/idempotency`: an `idempotency()` hook implementing the `Idempotency-Key` header semantics
  (replay, 409 in-flight, 422 on key reuse with a different payload), storing records in any `Repository<T>`.
  Works for HTTP and MCP callers.
- Opt-in RFC 9457 `application/problem+json` error bodies on every HTTP transport, understood by
  `@mantlejs/client`. The legacy error shape stays the default until 1.0.
- Conditional requests: `ETag` on `get`, `304` on `If-None-Match`, `412` on a failed `If-Match` for
  `update`/`patch`/`remove`.
- Request IDs and W3C `traceparent` propagation on every transport, bound into the logger. `@mantlejs/otel` adds
  OpenTelemetry spans around the hook pipeline and repository calls.
- A `health()` plugin serving liveness and readiness endpoints, with optional per-repository readiness checks.
- MCP: layered tool mode, tool annotations, `_meta` idempotency-key passthrough, `createMcpTestClient()`.
- `@mantlejs/tenancy`: `resolveTenant()` + `tenantScope()` hooks with row-level isolation over any adapter, a
  tenant-aware channel helper, and a conformance suite that every adapter's spec runs.
- LICENSE, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, issue/PR templates; a CI guard that fails when a package
  ships without a LICENSE; SPDX SBOM attached to each GitHub release; OpenSSF Scorecard.
- Logo v1 + brand tokens, applied to the site, README, favicon, and OG image.
- A Starlight blog and `docs/marketing/content-process.md`.

### Non-Goals (Phase 8)

Moved to the [Phase 9 backlog](./mantle-js-phase-9-backlog.md):

- `KnexTimeSeriesRepository`, `@mantlejs/arangodb`, GraphQL transport, Vue/Svelte/Solid/Angular bindings,
  Neptune/Cosmos adapters (carried from the Phase 8 backlog)
- `Deprecation` (RFC 9745) / `Sunset` (RFC 8594) headers and API versioning guidance
- Signed outbound webhooks (Standard Webhooks)
- Everything in the Phase 8 backlog's item 4 (Radix UI variant, persistent sandbox sessions, scaffold flags)

Explicitly out of scope for this phase's own features:

- **Schema-per-tenant or database-per-tenant isolation as shipped code.** v1 is row-level. Per-tenant
  repositories are documented as a pattern, not a feature (Decision #7).
- **A distributed rate-limit algorithm beyond fixed window.** Sliding window / GCRA can come later behind the
  same store interface (Decision #5).
- **A durable job queue** for anything (idempotency cleanup is TTL-based in the store).
- **An MCP client SDK.** Agents already use the official SDK. Phase 8 ships a test client only (Decision #9).
- **Dynamic `tools/list_changed` loading.** Layered mode uses stateless meta-tools instead (Decision #8).
- **Formal ISO certification.** Phase 8 adopts SPDX (ISO/IEC 5962) for SBOMs and checks dates against
  ISO 8601 / RFC 3339. OpenChain (ISO/IEC 5230, 18974) conformance is noted for later, not pursued.
- **Changing the default error body shape.** Problem Details is opt-in until 1.0.

---

## Delivery Sequence

1. **Foundations & spikes.**
   - Spec 1 (`context.http`, `params.ip`, request ID unification) — everything in Part A depends on it.
   - Three spikes, following the Phase 6/7 precedent (verify external mechanics, record findings in Decisions,
     then build):
     - Does every adapter's `save()` raise `Conflict` on a duplicate primary key? (Idempotency's atomic
       insert-if-absent relies on it.)
     - MCP SDK (`^1.29`): tool annotations, `_meta` on `tools/call`, and an in-memory transport for the test
       client.
     - Postgres row-level security via knex (`SET LOCAL` inside a transaction) as defense in depth for tenancy.
   - Part D's quick items (community files, homepages, LICENSE guard) can run any time.
2. **Build.** Three independent tracks that can run in parallel:
   - Part A (specs 2–7)
   - Part B (specs 8–11)
   - Part C (specs 12–14). Tenancy's rate-limit and audit integrations land after the relevant Part A specs.
3. **Brand, site & content.** Part D's logo and theming, Part E's blog and process doc. The new packages' docs
   land on the site here.
4. **Release.** Version, publish, SBOM, deploy the site.

---

## Phase 8 Specifications

### Part A — Production-grade API

#### 1. Foundations: response metadata, client IP, request ID

An additive change to `@mantlejs/mantle` and the three HTTP transports.

- **`context.http?: { status?: number; headers?: Record<string, string> }`** on `HookContext`. Any hook can set
  it. express/koa/http apply it to the response, on both success and error paths. socket.io and MCP ignore
  `headers` (they have no equivalent), but MCP maps a set `status` of 304 to a normal result.
  - A `status` of `304` or `204` sends no body.
  - `headers` set by before hooks survive an error thrown later in the pipeline (needed for `RateLimit` on a 429
    and `Retry-After`).
- **`MantleError.headers?`**: an error may carry response headers (e.g. `TooManyRequests` with
  `Retry-After`). Merged over `context.http.headers`. Not serialized into the body.
- **`context.event?: null`**: a before or after hook can set it to `null` to suppress the `service:event`
  emission for this call. Needed by spec 4: a replayed idempotent `create` short-circuits by setting
  `context.result` in a before hook (the pipeline already skips the service call when `result` is set), and
  must not broadcast a second `created` event.
- **New error class `PreconditionFailed` (412)**, for spec 5. `TooManyRequests` (429) and `Unavailable` (503)
  already exist.
- **`params.ip`**: the client address, set by each HTTP transport. Honors `X-Forwarded-For` only when the
  transport's `trustProxy` option is set (mirrors Express's `trust proxy`; default off).
- **`params.requestId`**: replaces the express/koa/http `x-correlation-id` middleware with one shared
  implementation in `@mantlejs/mantle`. Accepts an incoming `X-Request-Id` (and, for one release, the old
  `X-Correlation-Id`), else generates a UUID. Echoed in the response. Already bound into `withContext()`, so
  `@mantlejs/logger` picks it up.
- **CORS:** `exposedHeaders` defaults gain the headers Part A emits (`RateLimit`, `RateLimit-Policy`,
  `Retry-After`, `ETag`, `Idempotent-Replayed`, `X-Request-Id`), so browser clients can read them.

**Accept:** a shared transport conformance spec (one table, run by express, koa, and http) covering status
override, header set on success, header survival on error, 304/204 empty body, `params.ip` with and without
`trustProxy`, and request-ID echo/generation. socket.io and MCP specs prove they ignore `context.http.headers`.

#### 2. Problem Details (RFC 9457)

- Transport option `errors: "mantle" | "problem+json"` (default `"mantle"`, today's shape).
- `problem+json` maps a `MantleError` to:
  - `type`: `https://mantlejs.com/errors/<kebab-class-name>` (a docs page per error class — a resolvable URI is
    what the RFC recommends)
  - `title` (class name in words), `status`, `detail` (message), `instance` (request path)
  - extensions: `className`, `data`, `errors`, `hint`, `requestId`
- Non-`MantleError` exceptions map to a 500 with no leaked detail (same rule as today).
- `@mantlejs/client` parses both shapes into the same client error type, choosing by `Content-Type`.

**Accept:** transport conformance rows for both shapes; client specs for both; one docs page per error class.

#### 3. Rate limiting — `@mantlejs/ratelimit`

New package, depends on `@mantlejs/mantle`.

```typescript
app.service("articles").hooks({
  before: {
    all: [rateLimit({ policy: "default", limit: 100, windowSeconds: 60, key: byPrincipal() })],
    create: [rateLimit({ policy: "writes", limit: 10, windowSeconds: 60, key: byPrincipal() })],
  },
});
```

- **Store interface** `RateLimitStore { hit(key: string, windowSeconds: number, cost: number): Promise<{ count:
number; resetSeconds: number }> }`. It needs an atomic increment, which `Repository<T>` can't express, so
  this is its own interface (Decision #5).
  - `memoryStore()` ships in the package.
  - `redisStore(client)` ships in the package, typed against a minimal structural client interface so it
    works with `redis` or `ioredis` without a hard dependency (same approach as `@mantlejs/auth-redis`).
- **Algorithm:** fixed window. Maps one-to-one onto the draft's `q`/`w` policy parameters.
- **Key functions:** `byPrincipal()` (agent id → user id → ip, in that order), `byUser()`, `byAgent()`,
  `byTenant()` (Part C), `byIp()`, or any `(context) => string`. Internal calls (`provider === undefined`)
  are skipped by default.
- **Headers** per
  [draft-ietf-httpapi-ratelimit-headers-11](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/)
  (May 2026, not yet an RFC), via `context.http`:
  - `RateLimit-Policy: "default";q=100;w=60`
  - `RateLimit: "default";r=42;t=18`
  - On exceed: `TooManyRequests` with `Retry-After: 18`.
  - Multiple `rateLimit()` hooks on one call produce one list-valued header each, not one per hook.
  - The header format is isolated in one module, so a change in the draft is one edit (Decision #4).
- **MCP / socket.io:** the 429 surfaces as a normal error. MCP error text includes the retry delay, so agents
  can back off.

**Accept:** memory-store and Redis-store specs (Redis via testcontainers, matching `auth-redis`); header
format golden specs; multi-policy spec; agent-keyed spec through `@mantlejs/mcp`; README with a policy recipe.

#### 4. Idempotency keys — `@mantlejs/idempotency`

New package, depends on `@mantlejs/mantle`.

Implements
[draft-ietf-httpapi-idempotency-key-header](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)
(draft-07, expired April 2026 without becoming an RFC; Stripe-style semantics are the de facto standard —
Decision #3).

```typescript
const guard = idempotency({ store: new IdempotencyRepository(app), required: true, ttlSeconds: 86400 });

app.service("payments").hooks({
  before: { create: [guard.before] }, // register last in before: reserve the key or replay
  after: { create: [guard.after] }, // register last in after: store what the caller actually received
  error: { create: [guard.error] }, // release the key so the caller can retry
});
```

- **Applies to** `create` and `patch` (the non-idempotent methods). `update`/`remove` are already idempotent by
  definition, so the hook rejects being registered on them.
- **Key source:** `params.headers["idempotency-key"]` for HTTP; `_meta["com.mantlejs/idempotencyKey"]` for MCP
  tool calls (spec 10); `params.idempotencyKey` for internal calls and the client SDK.
- **Record:** `{ id: scope:key, fingerprint, status: "in-progress" | "completed", response, expiresAt }`, stored
  in any `Repository<T>`. `scope` = principal (user/agent) + service path + method, so one caller's key can't
  replay another caller's response.
- **Fingerprint:** SHA-256 over method, path, id, and canonicalized `data`.
- **Flow:**
  1. No key → pass through, or `BadRequest` when `required: true`.
  2. `save()` an `in-progress` record. A duplicate-id `Conflict` means the key exists (atomic insert-if-absent —
     verified per adapter by the spike, Decision #6).
  3. Existing + `in-progress` → `Conflict` (409).
  4. Existing + different fingerprint → `Unprocessable` (422).
  5. Existing + `completed` → set `context.result` to the stored result (the pipeline skips the service call),
     set `context.event = null` (no second broadcast), and set `Idempotent-Replayed: true`. The after hook
     recognizes the replay and doesn't rewrite the record.
  6. New → run the call. On success, mark `completed` with the result. On error, delete the record so the caller
     can retry (errors are not cached — Decision #6).
- **Expiry:** `expiresAt` is checked on read. Cleanup is the store's job (Redis TTL, or a documented periodic
  `deleteMany` for SQL). No queue.
- **Client:** `@mantlejs/client` gains `idempotencyKey?: string | true` on `create`/`patch` options. `true`
  generates a UUID once and reuses it across the client's own retries.

**Accept:** every flow branch above as a spec on `@mantlejs/memory`; the duplicate-id behavior spec on memory +
knex/sqlite; a concurrency spec (two parallel calls with the same key → one succeeds, one gets 409); HTTP and
MCP end-to-end specs; client specs.

#### 5. Conditional requests (ETag, `If-None-Match`, `If-Match`)

A `conditional()` hook in `@mantlejs/mantle` (no dependencies needed).

- **ETag source:** a `versionField` (e.g. `updatedAt`, `version`) when configured, else a weak ETag (`W/"…"`)
  from a hash of the serialized result.
- **`get`:** sets `ETag`. With a matching `If-None-Match`, responds `304` with no body.
- **`update`/`patch`/`remove`:** with `If-Match`, loads the current record and compares. A mismatch throws
  `PreconditionFailed` (412). `requireIfMatch: true` makes the header mandatory (428 is deferred — 412 with a
  hint is enough for v1).
- **Race:** the check-then-write is not atomic. When `versionField` is set and the repository supports it, the
  write adds the version to its where clause so a concurrent write loses cleanly. Without it, the window is
  documented. Final approach recorded as Decision #10 after implementation.
- `find` is out of scope (list ETags need a cache strategy).

**Accept:** specs for each branch, on memory + knex/sqlite; transport conformance rows for 304 and 412.

#### 6. Tracing — W3C Trace Context + `@mantlejs/otel`

- **Core:** `params.traceparent` / `params.tracestate` parsed from incoming headers (validated per W3C Trace
  Context, malformed values dropped). Carried through `withContext()`, so internal calls made inside a hook
  inherit them. `@mantlejs/logger` adds `traceId`/`spanId` to log lines when present.
- **`@mantlejs/otel`:** new package, depends on `@mantlejs/mantle`, peer `@opentelemetry/api`. `.configure(otel())`
  wraps every service method dispatch in a span (`mantle.service <path>.<method>`) with attributes
  `mantle.path`, `mantle.method`, `mantle.provider`, and `mantle.agent.id`. Before/after/error hooks become child
  events. Errors record the status code. Repositories are not instrumented directly — adapter drivers (pg,
  mongodb, …) already have OTel instrumentation.
- With no SDK registered, `@opentelemetry/api` is a no-op, so the overhead is negligible.

**Accept:** traceparent parsing specs (valid, malformed, absent); an `otel` spec with an in-memory span
exporter asserting span names, parentage from an incoming `traceparent`, and error status.

#### 7. Health checks

A `health()` plugin in `@mantlejs/mantle`, mounted via the `http:router` contract.

- `GET /health/live` → 200 while the process is up.
- `GET /health/ready` → 200 when every registered check passes, else 503. Each check has a timeout.
- Checks: `health({ checks: { db: () => repo.ping() } })`. Repositories may implement an optional
  `ping?(): Promise<void>`. Phase 8 adds it to `knex`, `mongodb`, `dynamodb`, and `supabase`.
- Body: a small JSON `{ status: "pass" | "fail", checks: { name: { status, durationMs, error? } } }`, loosely
  following the expired `draft-inadarei-api-health-check` shape. No secrets or connection strings in errors.
- Not a service: health endpoints never go through hooks, auth, or rate limiting.

**Accept:** specs on all three HTTP transports; per-adapter `ping` specs; deployment guide updated for Cloud Run
liveness/readiness probes.

### Part B — Agent-native MCP

#### 8. Layered tool mode

`McpOptions.mode` gains `"layered"`. Instead of one tool per exposed method, the server registers three:

| Tool               | Input                                  | Returns                                                                                                                                             |
| ------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_services`    | `{ query?: string }`                   | Paths visible to this session (filtered by the expose map and the agent's `CapabilityScope`), each with a one-line description and its method names |
| `describe_service` | `{ path: string; methods?: string[] }` | The input schemas, descriptions, and annotations for those methods — exactly what tool mode would have listed                                       |
| `call`             | `{ path, method, args }`               | The method result, through the same runner as tool mode                                                                                             |

- Same `describe()` metadata, same runner, same hook pipeline. The Phase 7 equivalence guarantee extends to a
  third mode: an equivalence spec asserts identical accept/reject decisions across tools, layered, and code.
- `call` validates `args` against the method's input schema before dispatch, so a bad call gets the same error
  tool mode would give.
- Stateless: works in the single-shot HTTP mode with no session.

**Accept:** spec per tool; scope filtering spec (an agent never sees a path it can't call); extended
`hook-pipeline-equivalence.spec.ts`; context-size comparison recorded in the README (tools listed on
`tools/list` for the knowledge-base example, eager vs layered).

#### 9. Tool annotations

Every generated tool (tool mode, layered `describe_service`) carries MCP tool annotations:

| Method        | `readOnlyHint` | `destructiveHint` | `idempotentHint`                                |
| ------------- | -------------- | ----------------- | ----------------------------------------------- |
| `find`, `get` | true           | false             | true                                            |
| `create`      | false          | false             | false (true when `idempotency()` is registered) |
| `update`      | false          | true              | true                                            |
| `patch`       | false          | true              | false                                           |
| `remove`      | false          | true              | true                                            |
| custom        | false          | true              | false (conservative defaults)                   |

Plus `title`, and `openWorldHint: false` (a Mantle service is a closed domain). Overridable per method in the expose
map (`annotations: { … }`). Emitted as the `annotations` field of each `tools/list` entry — `@mantlejs/mcp` uses the
SDK's low-level `Server`, not `McpServer.registerTool()` (Decision #13). Code mode's declarations gain a
JSDoc tag with the same hints.

**Accept:** table-driven spec; override spec; snapshot of code-mode declarations.

#### 10. Idempotency-key passthrough

- Tool and layered `call` read `_meta["com.mantlejs/idempotencyKey"]` from the `tools/call` request into
  `params.idempotencyKey`. Key name per the spike (Decision #13): the MCP spec says `_meta` prefixes SHOULD be
  reverse DNS, so `com.mantlejs/`, not `mantlejs/`.
- Code mode: `mantle.<path>.create(data, { idempotencyKey })` is allowed in the bridged API.
- Tool descriptions for idempotency-protected methods tell the agent to send a key and reuse it on retry.

**Accept:** end-to-end spec: agent retries a `create` with the same key → one record, replayed result.

#### 11. `createMcpTestClient()`

Exported from `@mantlejs/mcp`. Connects the official SDK client to an app's MCP server over the SDK's in-memory
transport, with an optional principal (user or agent token), so app authors can test their expose map, scopes,
and hooks without HTTP. A token is resolved through the same session-params path as the HTTP endpoint (bearer
`Authorization` header → `verifyJwt`), not hand-built `params`, so a test sees exactly what production sees
(Decision #13).

```typescript
const client = await createMcpTestClient(app, { agentToken });
expect(await client.listTools()).toMatchObject({ tools: [{ name: "articles_find" }] });
```

**Accept:** used by at least the `@mantlejs/mcp` and `@mantlejs/mcp-code` specs it replaces boilerplate in;
documented in the agents guide.

### Part C — Multi-tenancy

#### 12. `@mantlejs/tenancy` — resolution and row-level scoping

New package, depends on `@mantlejs/mantle`.

```typescript
app.hooks({ before: { all: [resolveTenant({ from: fromUserClaim("orgId") })] } });
app.service("articles").hooks({ before: { all: [tenantScope({ field: "orgId" })] } });
```

- **`resolveTenant({ from })`** sets `params.tenant = { id }`. Resolvers: `fromUserClaim(name)`,
  `fromAgent()` (the delegating user's tenant), `fromHeader(name)` (only valid together with an authorization
  check that the user belongs to that tenant — the resolver requires a `verify` function for this reason),
  `fromSubdomain()`, or a custom function. External calls with no resolvable tenant throw `Forbidden`.
  Internal calls without a tenant pass through only when `allowInternalWithoutTenant` is set.
- **`tenantScope({ field })`:**
  - `find`: ANDs `{ [field]: tenantId }` into `query.where` (wrapping an existing `$or` correctly).
  - `get`/`update`/`patch`/`remove`: loads the record and throws `NotFound` (not `Forbidden` — no existence
    leak) when it belongs to another tenant.
  - `create`: sets `field` on the data. A caller-supplied different value is a `Forbidden`.
  - `update`/`patch`: rejects a change to `field`.
  - Works on any `Repository<T>`, because it only uses `where` equality and `findById`.
- **Shared services:** a service without `tenantScope()` is global. A lint-like startup check
  (`assertTenantScoped(app, { except: [...] })`) fails fast when a service was missed.

**Accept:** the conformance suite (spec 14).

#### 13. Tenant-aware realtime, rate limits, and audit

- **Channels:** `tenantChannel(app)` helper joins each authenticated connection to a `tenant:<id>` channel and
  publishes service events only to the record's tenant channel. Covers socket.io and `@mantlejs/sync`'s
  cross-instance path.
- **Rate limits:** `byTenant()` key function in `@mantlejs/ratelimit`.
- **Audit:** `@mantlejs/audit` records `params.tenant.id` when present.
- **MCP:** code-mode and layered `list_services` are unaffected (scoping happens in hooks), but the agents guide
  documents that an agent token inherits the delegating user's tenant.
- **Postgres RLS (opt-in, confirmed by the spike — Decision #7):** a documented `knex` recipe, with RLS policies as a
  second line of defense under the hook. Each repository call runs in a transaction that first calls
  `set_config('app.tenant_id', $1, true)` (`SET LOCAL` can't take bind parameters), the app connects as a role that
  doesn't own the table, and the tenant reaches the repository explicitly via `repo.forTenant(params.tenant.id)`
  because `Repository<T>` methods never see `params`. Shipped as documentation plus a spec (whether to ship a
  `forTenant()` helper is decided in item 17).

**Accept:** a socket.io spec where tenant A's client never receives tenant B's event; audit spec; RLS recipe
validated against Postgres in the spike, then documented.

#### 14. Cross-tenant leak conformance suite

Exported from `@mantlejs/tenancy` (like `NESTED_QUERY_CASES` in core). Two tenants, seeded records, and a table
of attempts: find, get by foreign id, update/patch/remove a foreign id, create with a foreign tenant id, patch
the tenant field, `$or` injection to escape the scope, and dot-path where clauses. Each must return the
tenant's own data only, or `NotFound`/`Forbidden`.

**Accept:** run against `@mantlejs/memory` and `@mantlejs/knex` (sqlite + Postgres in CI), and as
translator-level specs for the other adapters where integration tests aren't possible.

### Part D — Open-source readiness & brand

#### 15. License, community files, repo metadata

- **LICENSE** — done 2026-10-12: root `LICENSE` (MIT) plus a copy in each of the 40 `packages/*`, since npm
  always packs a package-root `LICENSE` regardless of `files` (Decision #1).
- **Guard:** `tools/check-package-metadata.mjs`, run in CI, fails when a `packages/*` project is missing
  `LICENSE`, its `license` field isn't `MIT`, or its `homepage` isn't its mantlejs.com page.
- **npm homepage:** every package's `homepage` → `https://mantlejs.com/packages/<name>/` (all 40 pages verified
  live 2026-10-12).
- **Community files:** `CONTRIBUTING.md` (dev setup, Nx commands, commit convention, the dependency-matrix
  rule), `SECURITY.md` (GitHub private vulnerability reporting, supported versions), `CODE_OF_CONDUCT.md`
  (Contributor Covenant 2.1), `.github/ISSUE_TEMPLATE/` (bug, feature, adapter request), and
  `.github/pull_request_template.md`.
- **GitHub repo:** description, website, and topics updated (manual step, in the checklist).
- **Dates:** an audit that every serialized date is RFC 3339 (the ISO 8601 profile), with a note in the
  conventions table.

#### 16. Supply chain: SBOM, Scorecard, ASVS

- **SBOM:** the release workflow generates an SPDX (ISO/IEC 5962) SBOM per published package with `npm sbom
--sbom-format spdx` and attaches them to the GitHub release.
- **OpenSSF Scorecard:** the Scorecard GitHub Action on `main`, with the badge in the README. Fix the cheap
  findings (pinned action SHAs, token permissions, branch protection).
- **OWASP ASVS:** a Level 1 self-assessment (ASVS 5.0) of `auth`, `auth-local`, and `auth-oauth`, covering the
  authentication, session management, token, and cryptography chapters, recorded in `docs/security/asvs-l1.md`. Gaps become
  checklist items or backlog entries.

#### 17. Logo v1 + brand tokens

- The current mark (three amber chevrons on a dark tile, used for the GitHub org and the knowledge-base favicon)
  has the right colors — magma amber suits the name — but a generic shape. The site uses a different,
  unrelated indigo concentric-circle favicon.
- v1: an SVG mark drafted in-repo that keeps the amber palette and tells the name's story — a cross-section of
  Earth's layers with the mantle band highlighted. It's a v1; a designer can replace it later without touching
  anything else, because everything references the tokens and the asset files (Decision #12).
- Deliverables: `website/public/logo.svg`, `logo-mark.svg`, `favicon.svg` + `favicon.ico`, an OG image, and the
  GitHub org avatar PNG.
- Brand tokens (amber scale + a dark neutral) defined once in `website/src/styles/global.css`, mapped onto
  Starlight's accent variables and the registry demo theme. Light and dark modes both meet WCAG AA contrast.
- README header and the knowledge-base favicon updated to the new mark.

### Part E — Content process

#### 18. Blog + content process

- A Starlight blog on mantlejs.com (`starlight-blog`), with an RSS feed.
- `docs/marketing/content-process.md`:
  - **Source of truth:** the repo. Posts live in `website/src/content/docs/blog/`, video scripts in
    `docs/marketing/videos/`, and demo code in `examples/` (so it's built and tested in CI and can't rot).
  - **Video hosting:** YouTube. Each video gets a companion blog post that embeds it.
  - **Per-release pipeline:** changelog → release blog post → one short demo video → cross-post (X, LinkedIn,
    Reddit, Hacker News for major releases).
  - **Checklist per piece:** script, recorded demo from a tagged example, captions, links back to docs.
- First three pieces drafted: "Mantle in 5 minutes", "Expose your API to Claude with MCP", "Let the agent write
  the code: MCP code mode". Recording and publishing videos is outside the checklist.

### Part F — Release

#### 19. Release + post-release verification

- Stable group → `0.4.0`: `mantle` (`context.http`, `conditional()`, `health()`, `PreconditionFailed`,
  request ID, traceparent), `express`/`koa`/`http` (spec 1/2/7), `client` (Problem Details, idempotency key),
  `mcp` (layered, annotations, test client), `logger`, `audit`, `knex`/`mongodb`/`dynamodb`/`supabase` (`ping`).
- Experimental group → `0.4.0-experimental`: `mcp-code`, plus the new `ratelimit`, `idempotency`, `otel`,
  `tenancy` (Decision #11).
- SBOMs attached to the GitHub release. Site deployed. Post-release verification as in Phase 7.

---

## Release Plan

Same pipeline as Phase 7 (`nx release` with stable and experimental groups, npm provenance). The four new
packages join the `experimental` group in `nx.json`. `create-mantlejs` stays excluded from `nx release publish`
(Phase 7 item 14 precedent). The SBOM step is added to `release-publish.yml`.

---

## Package Structure Additions

```
packages/
├── ratelimit/     @mantlejs/ratelimit    rateLimit() hook, memory + Redis stores, IETF RateLimit headers
├── idempotency/   @mantlejs/idempotency  idempotency() hook over any Repository<T>
├── otel/          @mantlejs/otel         OpenTelemetry spans around the hook pipeline
└── tenancy/       @mantlejs/tenancy      resolveTenant(), tenantScope(), tenant channels, leak conformance suite
```

### Updated Package Dependency Rules (Phase 8 additions)

| Package               | May depend on                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| @mantlejs/ratelimit   | @mantlejs/mantle (test-only: @mantlejs/http, @mantlejs/mcp, @mantlejs/memory)                       |
| @mantlejs/idempotency | @mantlejs/mantle (test-only: @mantlejs/memory, @mantlejs/knex, @mantlejs/http, @mantlejs/mcp)       |
| @mantlejs/otel        | @mantlejs/mantle (+ peer @opentelemetry/api; test-only: @mantlejs/memory)                           |
| @mantlejs/tenancy     | @mantlejs/mantle (test-only: @mantlejs/memory, @mantlejs/knex, @mantlejs/socketio, @mantlejs/audit) |

`@mantlejs/audit`'s tenant field reads `params.tenant` structurally — no dependency on `@mantlejs/tenancy`.
The `CLAUDE.md` table and the `dependencyMatrix` export are edited together, per the existing rule.

---

## Success Metrics

- A knowledge-base example deployment with rate limiting, idempotent creates, ETags, tracing, health checks,
  and two tenants, all passing an end-to-end spec.
- Layered mode lists 3 tools instead of N for the knowledge-base example, with the eager vs layered
  `tools/list` size recorded in the `@mantlejs/mcp` README.
- The cross-tenant leak suite passes on memory, knex/sqlite, and knex/Postgres.
- Zero packages published without a LICENSE (CI guard), an SBOM on the 0.4.0 release, and a Scorecard badge.
- The new logo and brand tokens on the site, the README, and the GitHub org.
- Three content pieces drafted and the first blog post live.

---

## Architectural & Design Decisions

| #   | Decision                                                                                                                                                                     | Rationale                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Add MIT `LICENSE` at the root and in every package (done 2026-10-12, before this PRD's build work)                                                                           | Every package declared `"license": "MIT"` but none shipped the license text, which the MIT terms require. npm always packs a package-root `LICENSE`. Verified with `npm pack --dry-run`.                                                                    |
| 2   | Phase 8 = Parts A–E + multi-tenancy; time-series, ArangoDB, GraphQL, other UI framework bindings, Neptune/Cosmos, Deprecation/Sunset, and webhooks move to a Phase 9 backlog | None has a demand signal. Part A is what any production API is expected to have, and agents retrying and multi-customer deployments are the two failure modes Mantle's positioning (agent-native, BaaS-ready) runs into first.                              |
| 3   | Implement `Idempotency-Key` despite the IETF draft having expired (draft-07, April 2026)                                                                                     | The semantics (replay, 409, 422) are stable and widely deployed (Stripe and others). The header name won't change. If the draft is revived with changes, they land in one module.                                                                           |
| 4   | Emit the draft-11 `RateLimit` / `RateLimit-Policy` structured-field headers, not the legacy `X-RateLimit-*` trio                                                             | The draft is active (May 2026) and the WG's direction. The formatting is isolated in one module in case it changes before RFC.                                                                                                                              |
| 5   | Rate-limit stores get their own interface instead of `Repository<T>`; fixed window only in v1                                                                                | Rate limiting needs an atomic increment-with-expiry, which `Repository<T>` can't express without a race. Fixed window maps directly onto the draft's `q`/`w` parameters. Sliding window / GCRA can follow behind the same interface.                        |
| 6   | Idempotency records live in any `Repository<T>`, using duplicate-id `Conflict` as the atomic lock; failed calls are not cached                                               | Reuses every adapter Mantle already has. Not caching errors matches the draft's guidance and lets callers retry after a transient failure. **Spike (2026-10-21), per adapter — does `save()` with an existing id throw `Conflict` atomically?** memory ✅ (synchronous check-and-set). knex ✅ after fixes: the database's primary key is atomic on every client, but only Postgres's `23505` mapped to `Conflict` — SQLite (`SQLITE_CONSTRAINT_PRIMARYKEY`, verified against real SQLite), MySQL (`ER_DUP_ENTRY`/1062), and MSSQL (2627/2601) surfaced as 500s; MySQL/MSSQL codes are from driver docs, not run live (no Docker locally). The spike also found `save()` crashing on better-sqlite3 (not detected as RETURNING-capable) and the MySQL re-fetch using insert id `0` for a caller-supplied key; both fixed. supabase ✅ (PostgREST passes `23505` through). mongodb ✅ (`11000` on `_id`), **but ids must be 24-hex ObjectIds**, so the idempotency record id must be derived to fit (e.g. a truncated SHA-256 of `scope:key`) — decide in item 9. dynamodb ❌→✅: `save()` was an unconditional `PutItem` that silently overwrote; now conditioned on `attribute_not_exists` and mapped to `Conflict` (`saveAll`'s BatchWriteItem can't be conditioned and still overwrites — documented). pinecone, qdrant ❌ unsupported: both only upsert, with no documented insert-if-absent, so a read-then-write check would race; documented as overwriting and not usable as idempotency stores. neo4j: N/A (a `GraphRepository`, not a `Repository<T>`). |
| 7   | Multi-tenancy v1 is row-level, enforced in hooks; Postgres RLS is an opt-in recipe; schema/db-per-tenant is a documented pattern                                             | Row-level works on every adapter through `where` equality alone, which keeps it in the Application layer. RLS adds defense in depth where it's available. Per-tenant databases need connection management that belongs in a later phase, if demand appears. **RLS spike (2026-10-21, Postgres 16 via knex + pg, recorded in `packages/knex/src/lib/knex-repository-postgres.spec.ts`, which runs when `MANTLE_PG_URL` is set):** recipe confirmed. `set_config('app.tenant_id', $1, true)` is transaction-local: after commit or rollback the same pooled connection sees no tenant (tested with a 1-connection pool), and 20 interleaved calls for two tenants on a 2-connection pool never cross. `SET LOCAL` rejects bind parameters, so use `set_config()` (no string interpolation). A session-level `SET` does leak to the next checkout, so it's never used. With no tenant set, `current_setting(…, true)` is `NULL` (or `''` once the GUC has been touched in that session), so policies use `nullif(…, '')` and fail closed. A row of another tenant is invisible by id, so update/delete of it is `NotFound` (no existence leak); inserting or moving a row into another tenant fails `WITH CHECK` with SQLSTATE `42501`, now mapped to `Forbidden` (was `Unprocessable`). Superusers and table owners bypass RLS (owners unless `FORCE ROW LEVEL SECURITY`), so the app must connect as a separate non-owner role. Because `Repository<T>` methods never see `params`, the tenant is passed explicitly with `repo.forTenant(id)`; an AsyncLocalStorage approach was rejected because socket.io and MCP calls run outside a request context. PgBouncer in transaction mode is compatible in principle, since the setting is transaction-scoped (not tested). |
| 8   | Layered MCP mode uses three stateless meta-tools rather than `tools/list_changed` dynamic loading                                                                            | Single-shot HTTP mode has no session to change the tool list in, and many clients handle `list_changed` inconsistently. Meta-tools work everywhere and reuse the tool-mode runner, so equivalence holds.                                                    |
| 9   | No MCP client in `@mantlejs/client`, and no separate MCP client package; ship `createMcpTestClient()` instead                                                                | The callers of a Mantle MCP server are agents, which use the official SDK client. A Mantle wrapper would add little. A test client solves the real problem app authors have: testing their expose map and scopes.                                           |
| 10  | _Pending implementation:_ conditional-request write atomicity                                                                                                                | Decided once spec 5 shows which adapters can add a version check to the write's where clause.                                                                                                                                                               |
| 11  | New packages join the `experimental` release group                                                                                                                           | Same precedent as `mcp-code` in Phase 7: new surface stays at `-experimental` until it has settled.                                                                                                                                                         |
| 12  | Logo v1 drafted in-repo as SVG, built on the existing amber palette; replaceable later                                                                                       | The colors already suit the name. Everything references the tokens and asset files, so a designer's mark later is a file swap.                                                                                                                              |
| 13  | MCP SDK mechanics for specs 9–11 (spike 3, 2026-10-21, against `@modelcontextprotocol/sdk` 1.29.0)                                                                         | Pinned in `packages/mcp/src/lib/sdk-mechanics.spec.ts`. **Annotations:** `@mantlejs/mcp` registers tools through the low-level `Server.setRequestHandler(ListToolsRequestSchema)`, not `McpServer.registerTool()`, so annotations are a plain `annotations` field on each listed tool (`title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`); verified to reach the client intact. **`_meta`:** `request.params._meta` in the `tools/call` handler is a loose object, so a custom key arrives unchanged (absent → `undefined`), including over the single-shot HTTP path, which delivers messages verbatim. The MCP spec (2025-11-25) says `_meta` prefixes SHOULD be reverse DNS, so the key is `com.mantlejs/idempotencyKey` (spec 10 amended). **Test client:** `InMemoryTransport.createLinkedPair()` already backs the mcp/mcp-code specs' `connect()` helpers; independent pairs don't interfere. The one design point: resolve a test principal through the HTTP endpoint's session-params path rather than hand-built `params` (spec 11 amended). Nothing in specs 9–11 is contradicted. |

---

## Reference

- [Phase 8 Backlog](./mantle-js-phase-8-backlog.md) — the input to this PRD
- [Phase 9 Backlog](./mantle-js-phase-9-backlog.md) — items not taken
- [Phase 7 PRD](./mantle-js-phase-7-prd.md)
- [draft-ietf-httpapi-idempotency-key-header-07](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.txt)
- [draft-ietf-httpapi-ratelimit-headers-11](https://www.ietf.org/archive/id/draft-ietf-httpapi-ratelimit-headers-11.txt)
- RFC 9457 (Problem Details), RFC 9110 (HTTP Semantics — conditional requests), W3C Trace Context,
  RFC 3339 / ISO 8601, ISO/IEC 5962 (SPDX), OWASP ASVS 5.0, OpenSSF Scorecard
