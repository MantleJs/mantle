# Mantle JS — Phase 5 TDD: Release Readiness

Technical design for the [Phase 5 PRD](./mantle-js-phase-5-prd.md). Section numbers below are referenced from
the [Phase 5 checklist](./mantle-js-phase-5-checklist.md).

---

## Contents

1. [`@mantlejs/mcp`](#1-mantlejsmcp)
2. [`@mantlejs/auth-oauth` — POST callback support](#2-mantlejsauth-oauth--post-callback-support)
3. [`@mantlejs/auth-apple`](#3-mantlejsauth-apple)
4. [`@mantlejs/auth-microsoft`](#4-mantlejsauth-microsoft)
5. [`@mantlejs/auth-linkedin`](#5-mantlejsauth-linkedin)
6. [`@mantlejs/logger` hardening](#6-mantlejslogger-hardening)
7. [Multi-repository service verification](#7-multi-repository-service-verification)
8. [CLI + `create-mantle` verification](#8-cli--create-mantle-verification)
9. [Examples](#9-examples)
10. [Release engineering](#10-release-engineering)

---

## 1. `@mantlejs/mcp`

**Dependencies:** `@mantlejs/mantle`, `@modelcontextprotocol/sdk` (regular dependency — the package exists to
speak MCP; hand-rolling the protocol buys nothing).

### Public surface

```typescript
export interface McpOptions {
  /** Service paths to expose. Default: all registered services. */
  services?: string[];
  /** "stdio" runs a standalone MCP server; "http" mounts streamable HTTP on the app's transport. */
  transport: "stdio" | "http";
  /** HTTP transport only: mount path. Default: "/mcp". */
  path?: string;
  /** Server identity reported during MCP initialization. Defaults: name "mantle", app version. */
  serverInfo?: { name?: string; version?: string };
  /** Expose service events ("created" | "updated" | "patched" | "removed") as MCP resources. Default: false. */
  events?: boolean;
}

export function mcp(options: McpOptions): MantlePlugin;
```

### Tool generation

At configure time, iterate the app's registered services (respecting `options.services`); for each
`ServiceHandle`, call `describe()` and emit one tool per entry in `descriptor.methods`:

- **Naming:** `{path}_{method}` with `/` and `-` in the path normalized to `_` (`users_find`,
  `blog_posts_create`). Custom methods registered in `app.use()` options get tools the same way.
- **Input schemas** (JSON Schema — TypeBox output is already JSON Schema):
  - `find`: `{ query?: <QueryParamsSchema> }` where the `where`-operator enum is constrained to
    `descriptor.capabilities.operators` — an agent is never offered `$ilike` against DynamoDB
  - `get`/`remove`: `{ id: string | number, query?: … }`
  - `create`: `{ data: <entity schema> }` from the service's attached TypeBox schema; `{ data: { type: "object" } }`
    when no schema is attached (mirror the OpenAPI generator's never-skip rule)
  - `update`/`patch`: `{ id, data }` (patch uses `Partial`-ized schema: all properties optional)
- **Descriptions:** from the descriptor (service description + per-method text when present); fall back to a
  generated sentence ("Find users records matching a query").

Schema assembly reuses the same descriptor-reading approach as `@mantlejs/openapi` — but no shared code package
is introduced for it; the two generators read the same public `describe()` surface independently (revisit if a
third consumer appears).

### Dispatch

Every tool call routes through the service's dispatch path — the exact call shape the transports use — with
`params.provider = "mcp"`. The full hook pipeline (auth, validation, events) runs; there is no bypass.
Tool-call arguments map onto `(id, data, params)`; `query` lands in `params.query` exactly as a REST query
would after `parseQueryString` (values arrive typed from JSON, so no string coercion is needed — pass
`coerce: false`/skip the coercion path).

### Transports

- **`stdio`:** `mcp()` registers the server on the app; a `startMcp(app)` export (also wired as
  `app.get("mcp:server")`) connects a `StdioServerTransport`. Intended usage: a separate entry point
  (`mcp.ts`) that builds the app without `listen()`.
- **`http`:** mount a streamable-HTTP handler at `options.path` via the `http:router` contract
  (`router.post(path, …)` + `router.get(path, …)` for SSE), same acquisition pattern as
  `createOAuthPlugin` (`app.get("http:router") ?? app.get("express")`).

### Auth (HTTP transport)

A `Bearer` token on the MCP HTTP request is verified with the configured `AuthEngine` (same semantics as
`authenticate("jwt")`); the resolved user is placed on `params.user`/`params.authenticated` for every tool call
in that MCP session. No token → `params.user` unset → services' own `authenticate("jwt")` hooks reject exactly
as they would for an anonymous REST call. Auth is therefore enforced by the same hooks, not by the MCP layer.

### Errors

Hook/service errors are caught and returned as MCP **tool errors** (`isError: true`) with
`MantleError.toJSON()` as the content (name, message, code, data, `hint` when present). Protocol-level errors
are reserved for malformed MCP requests. A plain `Error` (should not happen — typed errors are the rule) maps
to the `GeneralError` shape.

### Events as resources (`events: true`)

Each exposed service contributes a resource `mantle://events/{path}`; the resource's contents are the last N
(default 50, ring buffer) service events with `{ event, path, data, timestamp }`. Subscriptions use MCP
resource-updated notifications driven by the service event emitters. This is deliberately minimal — agents that
need real-time should use the socket transport; this exists so an agent can poll "what changed".

### Testing

All specs in-process with `@mantlejs/memory` services — no real MCP client needed; use the SDK's
`InMemoryTransport` pair to drive `listTools`/`callTool`.

- Tool listing: two services (one schema'd `RepositoryService`, one custom with a custom method) → expected
  tool names + input schemas (operator enum matches `describe().capabilities.operators`)
- `services` allowlist filters; unknown path in allowlist → configure-time `BadRequest`
- `callTool("users_find", { query: { where: { age: { $gt: 21 } } } })` returns rows; unsupported operator →
  tool error naming the operator (proves `assertOperators` surfaced)
- Hook throwing `Forbidden` → tool error with code 403 + hint (proves pipeline ran); event emitted on create
  when hooks succeed
- HTTP: bearer token populates `params.user` (spec via a hook asserting it); missing token + `authenticate`
  hook → 401-shaped tool error

---

## 2. `@mantlejs/auth-oauth` — POST callback support

Additive change driven by Apple's `response_mode=form_post` (§3). No behavior change for shipped providers.

```typescript
export interface OAuthProvider {
  usePkce: boolean;
  defaultScope: string[];
  /** HTTP method of the provider's callback. Default "GET". "POST" providers (Apple) receive
   *  code/state (and Apple's one-time `user` field) in the form-encoded body. */
  callbackMethod?: "GET" | "POST";
  buildAuthUrl(params: AuthUrlParams): string;
  exchangeCode(params: CodeExchangeParams): Promise<string>;
  fetchProfile(accessToken: string, extras?: CallbackExtras): Promise<OAuthProfile>;
}

/** Raw callback payload fields a provider may need beyond code/state (e.g. Apple's `user` JSON). */
export interface CallbackExtras {
  body?: Record<string, unknown>;
}
```

In `createOAuthPlugin`:

- Extract the existing callback handler body into a shared `handleCallback(payload: Record<string, string | undefined>, extras)` closure
- `callbackMethod === "POST"` → register `router.post(callbackPath, …)` reading `code`/`state`/`error` from the
  parsed body (the transports already parse `application/x-www-form-urlencoded`; verify for `@mantlejs/http`
  and add if missing — it hand-rolls body parsing); otherwise register `router.get` reading `req.query`
  exactly as today
- `fetchProfile` gains the optional `extras` argument (backward compatible — existing providers ignore it)

**Specs:** POST callback happy path (state validated + deleted, token pair issued); POST with missing
state → `NotAuthenticated`; GET providers unaffected (existing specs stay green untouched); `extras.body`
reaches `fetchProfile`.

## 3. `@mantlejs/auth-apple`

**Dependencies:** `@mantlejs/mantle`, `@mantlejs/auth-oauth` (+ `arctic`, already the OAuth engine of record).

```typescript
export interface AppleStrategyConfig extends Omit<OAuthPluginConfig, "clientSecret"> {
  /** Services ID (the OAuth client_id, e.g. "com.example.app.web"). Inherited as clientId. */
  teamId: string;      // Apple Developer Team ID
  keyId: string;       // Key ID of the Sign in with Apple private key
  privateKey: string;  // PKCS#8 PEM contents of the .p8 key
}
export function appleStrategy(config: AppleStrategyConfig): MantlePlugin;
```

Provider specifics:

- `usePkce: false` (Apple does not support PKCE for web `form_post` flows via Arctic's `Apple` client);
  CSRF protection remains the `state` round-trip through the `OAuthStateStore`
- `defaultScope: ["name", "email"]`; `callbackMethod: "POST"` — `buildAuthUrl` appends
  `response_mode=form_post` (required whenever scopes are requested)
- **Client secret:** Arctic's `Apple` client signs the ES256 client-secret JWT from
  `teamId`/`clientId`/`keyId`/`privateKey` per exchange — no static secret ever exists. The
  `createOAuthPlugin` config still requires `clientSecret`; `appleStrategy` passes `clientSecret: ""` and the
  provider closure captures the real key material (config shape stays honest at the public boundary via
  `Omit`).
- **`exchangeCode` returns the `id_token`** (not the access token): Apple has no userinfo endpoint; the
  id_token is the profile source. It was obtained seconds earlier directly from Apple's token endpoint over
  TLS, so `fetchProfile` decodes its payload without a JWKS round-trip (documented in the provider comment);
  `sub` → `id`, `email` → `email`.
- **Name capture:** Apple sends a `user` JSON string in the callback body on the *first* authorization only.
  `fetchProfile` reads `extras.body.user`, parses `{ name: { firstName, lastName } }`, and sets
  `profile.name`; absent on subsequent logins — find-or-create only inserts it on first creation, so nothing
  is lost.
- `entityIdField` default: `"appleId"`.

**Specs:** auth URL contains `response_mode=form_post` + requested scopes; exchange failure →
`GeneralError`; profile from a stubbed id_token (base64url payload) with/without email; first-login `user`
body populates `name`; malformed `user` JSON ignored (profile still valid); missing `sub` → `GeneralError`.

## 4. `@mantlejs/auth-microsoft`

**Dependencies:** `@mantlejs/mantle`, `@mantlejs/auth-oauth` (+ `arctic`).

```typescript
export interface MicrosoftStrategyConfig extends OAuthPluginConfig {
  /** Entra tenant: "common" (default), "organizations", "consumers", or a tenant ID. */
  tenant?: string;
}
export function microsoftStrategy(config: MicrosoftStrategyConfig): MantlePlugin;
```

Provider mirrors `googleStrategy` almost exactly:

- `usePkce: true`; `defaultScope: ["openid", "profile", "email"]`; standard GET callback
- Arctic `MicrosoftEntraId(tenant, clientId, clientSecret, redirectUri)` for `buildAuthUrl`/`exchangeCode`
  (tenant captured in the provider closure — built per call like Google's, since `redirectUri` varies)
- `fetchProfile` GETs `https://graph.microsoft.com/oidc/userinfo` with the access token; `sub` → `id`,
  `email` → `email`, `name` → `name`; non-OK or missing `sub` → `GeneralError`
- `entityIdField` default: `"microsoftId"`

**Specs:** mirror `google-strategy.spec.ts` (URL construction incl. tenant default `"common"` and override;
PKCE verifier passthrough; exchange failure; userinfo normalization; missing sub).

## 5. `@mantlejs/auth-linkedin`

**Dependencies:** `@mantlejs/mantle`, `@mantlejs/auth-oauth` (+ `arctic`).

```typescript
export type LinkedInStrategyConfig = OAuthPluginConfig; // no provider-specific fields
export function linkedinStrategy(config: LinkedInStrategyConfig): MantlePlugin;
```

Uses LinkedIn's **OpenID Connect** flow — the "Sign In with LinkedIn using OpenID Connect" product must be
enabled on the LinkedIn developer app; the legacy `r_liteprofile`/v2 profile API is not touched. Provider
mirrors `googleStrategy` minus PKCE:

- `usePkce: false` — LinkedIn's authorization-code flow authenticates with the client secret only; CSRF
  protection is the `state` round-trip through the `OAuthStateStore` (same posture as GitHub/Facebook)
- `defaultScope: ["openid", "profile", "email"]`; standard GET callback
- Arctic `LinkedIn(clientId, clientSecret, redirectUri)` for `buildAuthUrl`/`exchangeCode` (built per call,
  since `redirectUri` varies — same as Google/Microsoft)
- `fetchProfile` GETs `https://api.linkedin.com/v2/userinfo` with the access token; `sub` → `id`,
  `email` → `email`, `name` → `name`; non-OK response or missing `sub` → `GeneralError`
- `entityIdField` default: `"linkedinId"`

**Specs:** mirror `google-strategy.spec.ts` (auth URL construction with scopes and state; no PKCE parameters
emitted; exchange failure → `GeneralError`; userinfo normalization with/without email; missing `sub` →
`GeneralError`).

## 6. `@mantlejs/logger` hardening

### 6.1 `Logger.child` (core, additive)

```typescript
// @mantlejs/mantle types.ts — additive optional member
export interface Logger {
  debug(msg: string, context?: Record<string, unknown>): void;
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  error(msg: string, context?: Record<string, unknown>): void;
  /** Returns a logger with `bindings` merged into every record. Optional — callers must feature-check. */
  child?(bindings: Record<string, unknown>): Logger;
}
```

`pinoAdapter` implements it via `pino.child(bindings)` (re-wrapped through `pinoAdapter` so RequestContext
merging survives). Hooks never call `child` unconditionally.

### 6.2 `createLogger(options)`

```typescript
export interface CreateLoggerOptions {
  /** Default: "info" when NODE_ENV === "production", else "debug". */
  level?: "debug" | "info" | "warn" | "error";
  /** Pino redact paths. Default: SENSITIVE_PATHS (exported): ["password", "*.password", "*.accessToken",
   *  "*.refreshToken", "*.authorization", "*.cookie"]. Pass [] to disable. */
  redact?: string[];
  /** Pretty-print via pino-pretty when available. Default: false. Ignored in production. */
  pretty?: boolean;
  /** Google Cloud structured logging: level → `severity` labels, message key "message". Default: false. */
  gcp?: boolean;
  /** Extra pino options merged last (escape hatch). */
  pino?: Record<string, unknown>;
}
export function createLogger(options?: CreateLoggerOptions): Logger; // pinoAdapter(pino(built))
```

- `pino` moves from "user brings an instance" to an **optional dependency** of `@mantlejs/logger`:
  `createLogger` throws `GeneralError` with an install hint if `pino` is not resolvable; `pinoAdapter`,
  `loglayerAdapter`, and the hooks remain dependency-free. `pino-pretty` is only ever dynamically imported
  when `pretty: true` outside production, and missing `pino-pretty` degrades to plain output with a one-time
  `warn`.
- `gcp: true` sets `messageKey: "message"` and a level formatter mapping to Cloud Logging `severity`
  (`debug`→DEBUG, `info`→INFO, `warn`→WARNING, `error`→ERROR).

### 6.3 Hook redaction

`logRequest` gains `redactParams?: string[]` (default `SENSITIVE_PATHS`), applied when
`includeParams: true`: a small own-code deep walk replacing matched paths with `"[Redacted]"` before the
record reaches the logger (works for non-pino adapters too; pino-level `redact` remains defense in depth).
`logError` redacts `error.data` with the same walker.

### 6.4 `loglayerAdapter`

```typescript
/** Duck-type of a LogLayer instance — no dependency on the loglayer package. */
export interface LogLayerLike {
  withMetadata(meta: Record<string, unknown>): { debug(msg: string): void; info(msg: string): void; warn(msg: string): void; error(msg: string): void };
  child?(): unknown;
}
export function loglayerAdapter(log: LogLayerLike): Logger;
```

Same shape as `pinoAdapter`: merges `getContext()` RequestContext into metadata, then
`log.withMetadata(merged)[level](msg)`. `child(bindings)` implemented by closing over merged bindings (not
LogLayer's own `child()`, whose semantics differ) — bindings are folded into every `withMetadata` call.
Documented in the README as the LogLayer integration path; `loglayer` itself is **not** a dependency of any
Mantle package (PRD decision #1).

**Specs:** level resolution by NODE_ENV; redaction of every `SENSITIVE_PATHS` entry (nested); gcp severity
mapping; missing-pino install-hint error (module mocked away); `child` bindings on every record + context
merge; `loglayerAdapter` against a recording stub; `logRequest` with `includeParams: true` emits
`[Redacted]` for `params.query.password`.

### 6.5 Deployment guidance (README)

Sections: Cloud Run (why `gcp: true`, stdout-only, no file transports), level configuration via
`@mantlejs/config` (`logger: { level: "info" }` convention + env override), process-level
`uncaughtException`/`unhandledRejection` wiring example, log-based metrics on `component`
(`mantle:request` / `mantle:error`), and "using LogLayer" with a transport fan-out example.

## 7. Multi-repository service verification

New spec `packages/mantle/src/lib/multi-repository-service.spec.ts` (spec-only — no runtime code changes):

- `ArticleService implements Service<Article>` taking `(articles: Repository<Article>, activity: Repository<ActivityEntry>)`,
  both `MemoryRepository`; `create` saves the article then an activity entry; `find`/`get` delegate;
  registered via `app.use("/articles", …)` with hooks (one `before` hook + event assertion) to prove the
  pipeline treats a multi-repo custom service identically to a `RepositoryService`
- Assertions: both repositories written on create; hook ran; `created` event emitted; a thrown `Conflict`
  from the second repository propagates untouched (documenting that cross-repo writes are *not* atomic)

Documentation:

- Root README (or `docs/`) section "Services with multiple repositories": the composition pattern, when to
  reach for it vs `RepositoryService`, cross-adapter composition (Knex + Mongo), and the transaction table:
  same-Knex-instance repositories can share `withTransaction` (pass the tx-scoped repo); cross-adapter pairs
  cannot — no distributed transactions (Phase 4 batch-atomicity reasoning applies)
- `RepositoryService` doc comment cross-references the pattern

The canonical example's `articles` service (§9) is the living instance: article repo + activity-log repo +
vector repo for embedding upserts.

## 8. CLI + `create-mantle` verification

- **Template refresh:** generator templates offer the current surface — database choices include
  `mongodb`; transport scaffold exposes `cors`; `generate authentication` lists all seven strategies
  (local, google, github, facebook, apple, microsoft, linkedin — plus the redis stores); generated `package.json` pins
  workspace-consistent versions (single source: a `versions.ts` map updated by the release process, §10)
- **Smoke test:** an Nx target (`e2e-scaffold`) run in CI: `create-mantle` into a temp dir (non-interactive
  flags/answers file) → install with the workspace packages linked (`file:`/local registry via Verdaccio) →
  `build` + `test` inside the scaffold → boot on an ephemeral port → `POST` + `GET` a scaffolded service
  (memory adapter) → assert 201/200 → SIGTERM, assert clean exit
- **Post-release rerun:** same target with `MANTLE_REGISTRY=https://registry.npmjs.org` resolving published
  versions — the post-release gate in the checklist
- Bug fixes only beyond this; no new CLI features this phase

## 9. Examples

### Workspace wiring

`examples/*` are Nx **application** projects (not libraries): excluded from publishing and from the
`@nx/enforce-module-boundaries` library matrix (apps may import any `@mantlejs/*`), included in
`build`/`test`/`lint` run-many so CI keeps them honest. TS path mappings resolve workspace packages
pre-release; the post-release verification temporarily installs registry versions (script-driven, not
committed).

### `examples/knowledge-base`

Two Nx projects: `knowledge-base-api` (Express transport) + `knowledge-base-web` (Vite + React + shadcn/ui,
`@mantlejs/client` + `@mantlejs/react`). Infra via `docker-compose.yml`: `pgvector/pgvector` Postgres +
Redis. Services:

| Service | Backing | Notes |
| --- | --- | --- |
| `users` | `KnexRepository` | local + google/github/apple/microsoft/linkedin strategies; `auth-redis` stores |
| `articles` | Knex + activity-log + `KnexVectorRepository` | the multi-repo showcase (§7); embedding upsert after create/patch |
| `comments` | `KnexRepository` | realtime events over socketio + sync |
| `attachments` | `@mantlejs/storage` | disk in dev; S3/GCS via env |
| `search` | `KnexVectorRepository` | `POST /search/similar` (VectorRepositoryService) |
| `activity` | `KnexRepository` | read-only feed (find/get) |

Embeddings: a local `Embedder` interface with a deterministic local default (hash-based bag-of-words vector —
zero keys, demo-quality by design) and an env-selected HTTP implementation slot for a real provider; the
example documents swapping it. Auth demo works with only local strategy configured — OAuth strategies
activate per-provider when env credentials are present.

Also wired: `openapi()` (+ Swagger UI at `/docs`), `mcp({ transport: "http" })`, `createLogger({ gcp })` in
prod mode, `@mantlejs/config` for all of the above, seed script, `README` walkthrough.

### Starters

- `examples/todo-minimal`: single file, `@mantlejs/http` + `@mantlejs/memory` + one `RepositoryService`;
  target < 100 lines including comments
- `examples/realtime-chat`: Express + socketio + knex/sqlite + auth-local; frontend is one static HTML page
  using `@mantlejs/client` from a script tag (bundled), showing `.on("created")` live updates

## 10. Release engineering

- **Tooling: `nx release`** (PRD decision #6). Config in `nx.json`: `projects` = all `packages/*` (examples
  excluded), fixed/locked version group so every package releases in lockstep at the same version,
  `version.generatorOptions.currentVersionResolver: "disk"`, changelog generation on, `releaseTagPattern:
  "v{version}"`. Two release groups — `stable` (version `0.1.0`, dist-tag `latest`) and
  `experimental` (version `0.1.0-experimental`, dist-tag `experimental`) — same major/minor, different
  suffix. Because an experimental package has no other published version, a plain
  `npm install @mantlejs/<name>` still resolves it; the dist-tag split only matters once stable promotions
  begin.
- **Verification scripts** (repo `tools/`): `check-publish-fields.ts` asserting every publishable
  `package.json` has `publishConfig.access: "public"`, `files: ["dist"]`, `exports`/`main`/`module`/`types`
  pointing into `dist`, license/repository fields, and peer ranges consistent with the workspace version —
  wired as an Nx target run in CI
- **Local rehearsal:** Verdaccio target (`npx nx release publish --registry http://localhost:4873` after
  `verdaccio` boot) — the CLI smoke test (§8) and one example run against the rehearsal registry before the
  real publish
- **npm org:** `@mantlejs` scope, 2FA required, granular automation token in CI secrets, `--provenance` on
  publish (GitHub Actions OIDC)
- **Publish order** is handled by `nx release publish` (dependency-ordered); the PRD's explicit order list is
  the human-readable statement of the same graph
- **Post-release:** smoke-install loop (`npm install` each package into a temp project, import it, assert the
  main export), `npm create mantle` live run, re-point `todo-minimal` at registry versions and boot, tag
  `v0.1.0` + GitHub release notes generated by `nx release changelog`

---

## Reference

- [Phase 5 PRD](./mantle-js-phase-5-prd.md)
- [Phase 5 Checklist](./mantle-js-phase-5-checklist.md)
- [Phase 6 Backlog](./mantle-js-phase-6-backlog.md)
- Prior art: [Phase 4 TDD](./mantle-js-phase4-tdd.md), `packages/auth-google/src/lib/google-strategy.ts`,
  `packages/auth-oauth/src/lib/create-oauth-plugin.ts`, `packages/logger/src/lib/*`
