# Mantle JS — Technical Design Document
# Phase 2

**Version:** 0.2.0-draft
**Status:** In Progress
**Companion:** [Mantle JS Phase 2 PRD](./mantle-js-phase-2-prd.md)
**Last Updated:** 2026-06-20

---

## Table of Contents

1. [Scope of This Document](#scope-of-this-document)
2. [Package Dependency Graph](#package-dependency-graph)
3. [Core Additions — `@mantlejs/mantle`](#core-additions--mantlejscore)
4. [Public API Surface — `@mantlejs/logger`](#public-api-surface--mantlejslogger)
5. [Public API Surface — `@mantlejs/schema`](#public-api-surface--mantlejsschema)
6. [Public API Surface — `@mantlejs/memory`](#public-api-surface--mantlejsmemory)
7. [Public API Surface — `@mantlejs/config`](#public-api-surface--mantlejsconfig)
8. [Public API Surface — `@mantlejs/auth-google`](#public-api-surface--mantlejsauth-google)
9. [Public API Surface — `@mantlejs/auth-github`](#public-api-surface--mantlejsauth-github)
10. [Public API Surface — `@mantlejs/socketio`](#public-api-surface--mantlejssocketio)
11. [Public API Surface — `@mantlejs/storage-s3`](#public-api-surface--mantlejsstorage-s3)
12. [Public API Surface — `@mantlejs/storage-gcs`](#public-api-surface--mantlejsstorage-gcs)
13. [Public API Surface — `@mantlejs/cli`](#public-api-surface--mantlejscli)
14. [Request Lifecycle Additions](#request-lifecycle-additions)

---

## Scope of This Document

This is a **thin TDD** for Phase 2. It covers:

- The updated full package dependency graph
- The exact public TypeScript API surface for every Phase 2 addition
- Data flow walkthroughs for the new concerns: logging, schema validation, and Socket.io real-time events

Internal implementation details are deferred to the full TDD, produced as implementation progresses.

---

## Package Dependency Graph

### Dependency Rules (updated for Phase 2)

- Dependencies always point **inward** — outer packages depend on inner packages, never the reverse
- `@mantlejs/mantle` retains **zero** external runtime dependencies
- `@mantlejs/storage-s3` and `@mantlejs/storage-gcs` depend on `@mantlejs/storage`, not directly on `@mantlejs/mantle`
- `@mantlejs/cli` is a code generator with no runtime imports from any Mantle package

### Full Graph (Phase 1 + Phase 2)

```text
@mantlejs/mantle                        (no external deps)
│
├── @mantlejs/express                 depends on: @mantlejs/mantle, express
├── @mantlejs/knex                    depends on: @mantlejs/mantle, knex
├── @mantlejs/auth                    depends on: @mantlejs/mantle, jsonwebtoken
│   ├── @mantlejs/auth-local          depends on: @mantlejs/mantle, @mantlejs/auth, @node-rs/argon2
│   ├── @mantlejs/auth-google         depends on: @mantlejs/mantle, @mantlejs/auth       [NEW P2]
│   └── @mantlejs/auth-github         depends on: @mantlejs/mantle, @mantlejs/auth       [NEW P2]
├── @mantlejs/storage                  depends on: @mantlejs/mantle, busboy
│   ├── @mantlejs/storage-s3           depends on: @mantlejs/storage, @aws-sdk/client-s3 [NEW P2]
│   └── @mantlejs/storage-gcs          depends on: @mantlejs/storage, @google-cloud/storage [NEW P2]
├── @mantlejs/logger                  depends on: @mantlejs/mantle, pino                 [NEW P2]
├── @mantlejs/schema                  depends on: @mantlejs/mantle, @sinclair/typebox    [NEW P2]
├── @mantlejs/memory                  depends on: @mantlejs/mantle                       [NEW P2]
├── @mantlejs/config                  depends on: @mantlejs/mantle, @sinclair/typebox*   [NEW P2]
└── @mantlejs/socketio                depends on: @mantlejs/mantle, socket.io            [NEW P2]

@mantlejs/cli                         (no runtime deps — code generator only)          [NEW P2]

* @sinclair/typebox is an optional peer dependency of @mantlejs/config
```

### Dependency Matrix (full Phase 1 + Phase 2)

| Package | core | express | knex | auth | auth-local | storage | logger | schema | memory | config | auth-google | auth-github | socketio | storage-s3 | storage-gcs | cli |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `core` | — | | | | | | | | | | | | | | | |
| `express` | ✅ | — | | | | | | | | | | | | | | |
| `knex` | ✅ | | — | | | | | | | | | | | | | |
| `auth` | ✅ | | | — | | | | | | | | | | | | |
| `auth-local` | ✅ | | | ✅ | — | | | | | | | | | | | |
| `storage` | ✅ | | | | | — | | | | | | | | | | |
| `logger` | ✅ | | | | | | — | | | | | | | | | |
| `schema` | ✅ | | | | | | | — | | | | | | | | |
| `memory` | ✅ | | | | | | | | — | | | | | | | |
| `config` | ✅ | | | | | | | | | — | | | | | | |
| `auth-google` | ✅ | | | ✅ | | | | | | | — | | | | | |
| `auth-github` | ✅ | | | ✅ | | | | | | | | — | | | | |
| `socketio` | ✅ | | | | | | | | | | | | — | | | |
| `storage-s3` | | | | | | ✅ | | | | | | | | — | | |
| `storage-gcs` | | | | | | ✅ | | | | | | | | | — | |
| `cli` | | | | | | | | | | | | | | | | — |

---

## Core Additions — `@mantlejs/mantle`

### `Logger` interface

Added to the public API surface of `@mantlejs/mantle`. No implementation is shipped. Zero new dependencies.

```typescript
interface Logger {
  debug(msg: string, context?: Record<string, unknown>): void;
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  error(msg: string, context?: Record<string, unknown>): void;
}
```

`MantleApplication.get('logger')` returns `Logger | undefined`. All Mantle packages access the logger via:

```typescript
app.get<Logger | undefined>('logger')?.debug('Service registered', {
  component: 'mantle:core',
  path,
});
```

The `component` field is a string in the format `mantle:<package>` (e.g. `mantle:core`, `mantle:knex`, `mantle:auth`). Third-party plugins should use their own namespace (e.g. `my-plugin:auth`).

### `RequestContext` — `AsyncLocalStorage`-based request context

Added to the public API surface of `@mantlejs/mantle`. Uses Node.js built-in `AsyncLocalStorage` — zero new dependencies.

```typescript
export interface RequestContext {
  correlationId: string;
  [key: string]: unknown;
}

export function withContext<T>(context: RequestContext, fn: () => T): T;
export function getContext(): RequestContext | undefined;
```

`withContext` runs `fn` inside an `AsyncLocalStorage` scope. All async operations (promises, callbacks) spawned within `fn` inherit the context. `getContext` returns the current context, or `undefined` when called outside a `withContext` scope.

**Express middleware** (registered automatically by the `express()` plugin) sets a `correlationId` per request:
- Reads `X-Correlation-ID` request header if present; otherwise generates a `crypto.randomUUID()`.
- Echoes the ID back in the `X-Correlation-ID` response header.
- Wraps the entire downstream request chain in `withContext({ correlationId }, next)`.

**`pinoAdapter`** calls `getContext()` on every log call and merges the result into the pino object, so `correlationId` appears in every log record emitted during a request — with no manual threading required.

Custom loggers and hooks can also call `getContext()` directly to read the correlation ID.

### `ServiceOptions` — `schema` field (additive)

```typescript
interface ServiceOptions {
  methods?: string[];
  events?: string[];
  schema?: TSchema;  // [NEW P2] — TypeBox schema, stored for tooling introspection
}
```

### `ServiceHandle<T>` — `schema` and `methods` properties (additive)

```typescript
interface ServiceHandle<T> extends Service<T> {
  hooks(config: HookConfig<T>): this;
  schema?: TSchema;     // [NEW P2] — set when schema is passed to app.use()
  readonly methods: string[];  // [NEW P2] — allowed methods (standard + custom)
}
```

### `MantleApplication` — event bus (additive)

Added to the public API surface of `@mantlejs/mantle`. Uses Node.js `EventEmitter` internally — zero new dependencies.

```typescript
interface MantleApplication {
  // ...existing...
  on(event: string, listener: (...args: unknown[]) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this;
  emit(event: string, ...args: unknown[]): void;
}
```

After every successful service mutation (`create`, `update`, `patch`, `remove`), core emits a `'service:event'` on the application — regardless of which transport triggered the call:

```typescript
// Emitted internally by ServiceHandleImpl after each successful mutation
app.emit('service:event', path, eventName, result, params);
// e.g. app.emit('service:event', 'users', 'created', newUser, { provider: 'rest', ... })
```

Transports subscribe once and fan out to their clients. This is what enables REST mutations to automatically trigger socket broadcasts with no extra wiring.

### `ServiceParams` — `connection` field (additive)

```typescript
interface ServiceParams {
  // ...existing...
  /** Per-socket persistent state. Set by the socket.io transport; persists across calls from the same connection. */
  connection?: Record<string, unknown>;
}
```

### Channel types (additive)

```typescript
interface MantleChannel {
  readonly connections: Record<string, unknown>[];
  join(connection: Record<string, unknown>): this;
  leave(connection: Record<string, unknown>): this;
  filter(fn: (data: unknown, connection: Record<string, unknown>) => boolean): MantleChannel;
}

interface PublishContext {
  app: MantleApplication;
  path: string;
  params: ServiceParams;
}

type ChannelPublisher<T = unknown> = (
  data: T | T[] | Paginated<T>,
  context: PublishContext,
) => MantleChannel | MantleChannel[] | null | undefined | void;
```

### `MantleApplication` — channel methods (additive)

```typescript
interface MantleApplication {
  // ...existing...
  channel(name: string | string[]): MantleChannel;
  publish<T = unknown>(publisher: ChannelPublisher<T>): this;
}
```

`channel()` throws `GeneralError` if called before `socketio()` is configured. The socketio plugin installs the channel registry via `app.set('__channelFactory', factory)`.

`app.channel(['a', 'b'])` returns a `CombinedChannel` — the deduplicated union of both channels' connections.

### `ServiceHandle<T>` — channel publisher (additive)

```typescript
interface ServiceHandle<T> extends Service<T> {
  // ...existing...
  publish(publisher: ChannelPublisher<T>): this;
  readonly publisher?: ChannelPublisher<unknown>;
}
```

---

## Public API Surface — `@mantlejs/logger`

### Exports

```typescript
export function logger(adapter: Logger): MantlePlugin;
export function pinoAdapter(pinoInstance: pino.Logger): Logger;
export function logRequest(options?: LogRequestOptions): HookFunction;
export function logError(options?: LogErrorOptions): HookFunction;
export type { PinoLike, LogRequestOptions, LogErrorOptions };
```

### `logger(adapter)`

```typescript
function logger(adapter: Logger): MantlePlugin;
```

Registers the adapter on the app via `app.set('logger', adapter)`. Must be called before any other plugin that emits logs.

### `pinoAdapter(pinoInstance)`

```typescript
function pinoAdapter(pinoInstance: pino.Logger): Logger;
```

Wraps a pino logger to satisfy the `Logger` interface. Translates the interface's `(msg, context?)` argument order to pino's `(context, msg)` form for structured logging. On every log call, reads `getContext()` from `@mantlejs/mantle` and merges the current `RequestContext` (including `correlationId`) into the pino object. Per-call context fields take precedence over request context fields.

```typescript
import pino from 'pino';
import { logger, pinoAdapter } from '@mantlejs/logger';

app.configure(
  logger(pinoAdapter(pino({ level: process.env.LOG_LEVEL ?? 'info' })))
);
```

### `LogRequestOptions`

```typescript
interface LogRequestOptions {
  /** Log level for successful requests. Default: 'debug' */
  level?: 'debug' | 'info';
  /** Include params object in record. Default: false */
  includeParams?: boolean;
}
```

### `LogErrorOptions`

```typescript
interface LogErrorOptions {
  /** Map 4xx to 'warn', 5xx to 'error'. Default: true */
  levelByCode?: boolean;
  /** Include stack trace in record. Default: process.env.NODE_ENV !== 'production' */
  includeStack?: boolean;
}
```

### Log record shapes

**`logRequest` — success record:**
```typescript
{
  component: 'mantle:request';
  method: string;           // 'find' | 'get' | 'create' | 'update' | 'patch' | 'remove'
  path: string;             // service path, e.g. 'users'
  provider: string;         // 'rest' | 'socket.io' | undefined
  id?: Id;                  // only for get, update, patch, remove
  durationMs: number;
  status: 'ok';
  params?: ServiceParams;   // only if includeParams: true
}
```

**`logRequest` — error record** (register the same hook in `error.all` to capture failed-request timing):
```typescript
{
  component: 'mantle:request';
  method: string;
  path: string;
  provider: string | undefined;
  id?: Id;
  durationMs: number;
  status: 'error';
  params?: ServiceParams;   // only if includeParams: true
}
```
Message: `"Service call failed"` (vs `"Service call completed"` on success).

**`logError` — error record:**
```typescript
{
  component: 'mantle:error';
  method: string;
  path: string;
  provider: string | undefined;
  code: number;         // HTTP status code from MantleError
  name: string;         // e.g. 'NotFound', 'Conflict'
  message: string;
  stack?: string;       // only if includeStack: true
}
```

When `pinoAdapter` is used and the request was initiated via the Express transport, all records automatically include `correlationId` merged from `RequestContext`. Example merged record:

```json
{
  "correlationId": "a3f2c1d4-...",
  "component": "mantle:request",
  "method": "create",
  "path": "users",
  "provider": "rest",
  "durationMs": 12,
  "status": "ok"
}
```

---

## Public API Surface — `@mantlejs/schema`

### Exports

```typescript
// Re-exported from @sinclair/typebox
export { Type, Kind, Hint, FormatRegistry } from '@sinclair/typebox';
export type { Static, TSchema, TObject, TString, TNumber, TBoolean, TArray, TOptional } from '@sinclair/typebox';

// Mantle-specific additions
export function validate<T extends TSchema>(schema: T, options?: ValidateOptions): HookFunction;
export function validate(validator: ValidatorFn, options?: Pick<ValidateOptions, 'target'>): HookFunction;
export function resolver<T, C = undefined>(map: ResolverMap<T, C>, options?: ResolverOptions<T, C>): HookFunction;

export type ValidatorFn = (data: unknown) => Array<{ field: string; message: string }> | null | undefined;
export interface ValidateOptions { ... }
export type ResolverMap<T, C = undefined> = { ... };
export type FieldResolver<T, K extends keyof T, C = undefined> = { ... };
export interface ResolverOptions<T, C> { ... }
```

### `validate(schema, options?)` — TypeBox + Ajv path

```typescript
function validate<T extends TSchema>(schema: T, options?: ValidateOptions): HookFunction;

interface ValidateOptions {
  /** Source to validate. Default: 'data' */
  target?: 'data' | 'result' | 'query';
  /** Coerce input types to schema types via Value.Convert before validation. Default: false */
  coerce?: boolean;
  /** Strip properties absent from the schema via Value.Clean before validation. Default: false */
  stripAdditional?: boolean;
}
```

Validation is performed by **Ajv** (single shared instance with `allErrors: true, strict: false`) using RFC-compliant format implementations from **`ajv-formats`**. Compiled validators are cached in a `WeakMap` keyed on the schema object reference — compilation happens once per schema, not per request.

`coerce` and `stripAdditional` are handled by TypeBox's `Value.Convert` and `Value.Clean` as pre-processing steps before Ajv validates the (potentially transformed) value. The transformed value is written back to `ctx.data`, `ctx.result`, or `ctx.params.query` when either option is true.

On failure, throws:

```typescript
throw new Unprocessable('Validation failed', {
  errors: (ajvFn.errors ?? []).map((e) => ({
    field: e.instancePath,   // e.g. '/email', '/name'
    message: e.message ?? 'invalid',
  })),
});
```

### `validate(validator, options?)` — BYOV path

```typescript
type ValidatorFn = (data: unknown) => Array<{ field: string; message: string }> | null | undefined;

function validate(validator: ValidatorFn, options?: Pick<ValidateOptions, 'target'>): HookFunction;
```

When the first argument is a function, the TypeBox + Ajv path is bypassed entirely. The validator function receives the raw data and returns either an array of field errors (throws `Unprocessable`) or `null`/`undefined`/empty array (passes). `coerce` and `stripAdditional` do not apply — the custom validator is responsible for any transforms.

```typescript
// Example: Zod validator
import { z } from "zod";
import type { ValidatorFn } from "@mantlejs/schema";

const UserZod = z.object({ email: z.string().email(), name: z.string().min(1) });

const zodValidator: ValidatorFn = (data) => {
  const result = UserZod.safeParse(data);
  if (result.success) return null;
  return result.error.issues.map((i) => ({
    field: "/" + i.path.join("/"),
    message: i.message,
  }));
};

app.service("users").hooks({
  before: { create: [validate(zodValidator)] },
});
```

Note: Ajv is a hard dependency of `@mantlejs/schema` and is always loaded, regardless of which overload is used. BYOV is an escape hatch for custom validation logic, not for removing the Ajv dependency.

### `resolver(map, options?)`

```typescript
type FieldResolver<T, K extends keyof T, C = undefined> = (
  value: T[K] | undefined,
  data: T,
  context: HookContext,
  shared: C,
) => Promise<T[K] | undefined> | T[K] | undefined;

type ResolverMap<T, C = undefined> = {
  [K in keyof T]?: FieldResolver<T, K, C>;
};

interface ResolverOptions<T, C> {
  createContext?: (record: T, ctx: HookContext) => Promise<C> | C;
}

function resolver<T, C = undefined>(map: ResolverMap<T, C>, options?: ResolverOptions<T, C>): HookFunction;
```

Runs after the service method (after hook). Iterates the map, calls each resolver, and writes the result back to the record. Field resolvers returning `undefined` cause that field to be deleted from the output.

Supports single records (`T`), arrays (`T[]`), and paginated results (`Paginated<T>`).

**Shared context:** `createContext` is called once per record before field resolvers run. Its return value is passed as the fourth argument to every field resolver in the map. Use this to perform a single async lookup (e.g. permissions check, role fetch) shared across multiple fields without repeating the call.

```typescript
resolver<User, { isAdmin: boolean }>(
  {
    role:   (_, data, ctx, shared) => shared.isAdmin ? data.role : 'viewer',
    badge:  (_, data, ctx, shared) => shared.isAdmin ? 'admin' : null,
  },
  {
    createContext: async (record) => ({ isAdmin: await checkAdmin(record.id) }),
  },
)
```

Existing field resolvers that do not use the fourth argument continue to work — TypeScript allows functions with fewer parameters to satisfy a function type with more parameters.

### Bringing your own validation package

The hook pipeline is fully open — `validate()` and `resolver()` are plain `HookFunction` implementations with no required registration. Any developer can bypass `@mantlejs/schema` entirely and write hooks against any library. The only contract: throw `Unprocessable` (from `@mantlejs/mantle`) on failure so the Express error handler serializes the response consistently:

```typescript
import { z } from "zod";
import { Unprocessable } from "@mantlejs/mantle";

const UserZod = z.object({ email: z.string().email(), name: z.string().min(1) });

app.service("users").hooks({
  before: {
    create: [
      (ctx) => {
        const result = UserZod.safeParse(ctx.data);
        if (!result.success) {
          throw new Unprocessable("Validation failed", {
            errors: result.error.issues.map((i) => ({
              field: "/" + i.path.join("/"),
              message: i.message,
            })),
          });
        }
        return ctx;
      },
    ],
  },
});
```

---

## Public API Surface — `@mantlejs/memory`

### Exports

```typescript
export class MemoryRepository<T extends Record<string, unknown>> implements Repository<T>;
export interface MemoryRepositoryOptions { ... }
```

### `MemoryRepository<T>`

```typescript
class MemoryRepository<T extends Record<string, unknown>> implements Repository<T, Partial<T>> {
  constructor(options?: MemoryRepositoryOptions);

  // Repository<T> implementation
  findAll(params?: QueryParams): Promise<T[]>;
  findById(id: Id): Promise<T | null>;
  save(data: Partial<T>): Promise<T>;
  saveAll(data: Partial<T>[]): Promise<T[]>;
  updateById(id: Id, data: Partial<T>): Promise<T>;
  patchById(id: Id, data: Partial<T>): Promise<T>;
  deleteById(id: Id): Promise<T>;
  count(params?: QueryParams): Promise<number>;

  // Test helpers
  seed(records: T[]): this;
  clear(): this;
  readonly store: ReadonlyMap<Id, T>;
}

interface MemoryRepositoryOptions {
  idField?: string;    // Default: 'id'
  autoId?: boolean;    // Default: true — generates UUID via crypto.randomUUID()
  timestamps?: boolean; // Default: true — manages createdAt / updatedAt
}
```

### QueryParams operator support

All `QueryParams` operators defined in `@mantlejs/mantle` are implemented in-memory using the same semantics as `KnexRepository`. A test using `MemoryRepository` can be swapped for a `KnexRepository` in production with no query changes.

Supported: equality, null, `$gt`, `$gte`, `$lt`, `$lte`, `$ne`, `$in`, `$nin`, `$like`, `$notlike`, `$ilike`, `$or`, `$and`, `limit`, `skip`, `sort`, `select`.

> `$ilike` performs case-insensitive match in-memory — behaviour matches PostgreSQL's `ILIKE`.

---

## Public API Surface — `@mantlejs/config`

### Exports

```typescript
export function config(options?: ConfigOptions): MantlePlugin;
export interface ConfigOptions { ... }
```

### `config(options?)`

```typescript
function config(options?: ConfigOptions): MantlePlugin;

interface ConfigOptions {
  directory?: string;   // Default: path.join(process.cwd(), 'config')
  schema?: TSchema;     // TypeBox schema — validates merged config at startup
  envVar?: string;      // Default: 'NODE_ENV'
}
```

### Config loading algorithm

```
1. Load {directory}/default.json           → base
2. Load {directory}/{NODE_ENV}.json        → overlay (merged deeply over base)
3. Apply MANTLE_* environment variables    → top-level overrides
4. If options.schema provided: validate merged config
   → throws GeneralError('Invalid configuration', { errors }) on failure
5. app.set('config', mergedConfig)
6. For each top-level key in mergedConfig: app.set(key, value)
```

Environment variable override format: `MANTLE_PORT=8080` sets `config.port = 8080`. Nested keys use double underscore: `MANTLE_DB__POOL__MAX=25` sets `config.db.pool.max = 25`.

### Accessing configuration

```typescript
// Full config object
const cfg = app.get<AppConfig>('config');

// Individual keys (set by plugin for convenience)
const port = app.get<number>('port');
const dbClient = app.get<string>('db.client'); // not supported — use app.get('config').db.client
```

---

## Public API Surface — `@mantlejs/auth-google`

### Exports

```typescript
export function googleStrategy(config: GoogleStrategyConfig): MantlePlugin;
export interface GoogleStrategyConfig { ... }
```

### `googleStrategy(config)`

```typescript
function googleStrategy(config: GoogleStrategyConfig): MantlePlugin;

interface GoogleStrategyConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl?: string;         // Default: '/auth/google/callback'
  scope?: string[];             // Default: ['openid', 'profile', 'email']
  entity?: string;              // Default: 'users'
  entityIdField?: string;       // Default: 'googleId'
}
```

### OAuth flow (authorization code)

```
GET /auth/google
  → builds Google authorization URL with state + code_challenge (PKCE)
  → 302 redirect to accounts.google.com

GET /auth/google/callback?code=...&state=...
  → verifies state
  → exchanges code for Google access token
  → fetches Google userinfo (id, email, name, picture)
  → calls app.service(entity).find({ query: { [entityIdField]: googleId } })
      → if found: use existing user
      → if not found: calls app.service(entity).create({ googleId, email, name })
  → issues Mantle access + refresh tokens via @mantlejs/auth
  → responds: { accessToken, refreshToken, user }
```

### Response shape

Identical to `@mantlejs/auth-local` login response:

```typescript
interface OAuthAuthenticationResult {
  accessToken: string;
  refreshToken: string;
  user: Record<string, unknown>;  // sanitized user entity
}
```

---

## Public API Surface — `@mantlejs/auth-github`

### Exports

```typescript
export function githubStrategy(config: GithubStrategyConfig): MantlePlugin;
export interface GithubStrategyConfig { ... }
```

### `githubStrategy(config)`

```typescript
function githubStrategy(config: GithubStrategyConfig): MantlePlugin;

interface GithubStrategyConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl?: string;         // Default: '/auth/github/callback'
  scope?: string[];             // Default: ['user:email']
  entity?: string;              // Default: 'users'
  entityIdField?: string;       // Default: 'githubId'
}
```

### OAuth flow (authorization code)

```
GET /auth/github
  → builds GitHub authorization URL with state
  → 302 redirect to github.com/login/oauth/authorize

GET /auth/github/callback?code=...&state=...
  → verifies state
  → exchanges code for GitHub access token (POST github.com/login/oauth/access_token)
  → fetches user profile (GET api.github.com/user)
  → fetches user emails (GET api.github.com/user/emails) if email not in profile
  → find-or-create user via app.service(entity)
  → issues Mantle access + refresh tokens
  → responds: { accessToken, refreshToken, user }
```

---

## Public API Surface — `@mantlejs/socketio`

### Exports

```typescript
export function socketio(options?: SocketioOptions): MantlePlugin;
export interface SocketioOptions { ... }
```

### `socketio(options?)`

```typescript
function socketio(options?: SocketioOptions): MantlePlugin;

interface SocketioOptions {
  serverOptions?: Partial<ServerOptions>;  // socket.io Server constructor options
  timeout?: number;                        // Default: 30000ms
  path?: string;                           // Default: '/socket.io'
}
```

### Socket.io server attachment

The plugin attaches to the HTTP server created by `@mantlejs/express`. It must be configured after `express()`:

```typescript
const app = mantle()
  .configure(express())
  .configure(socketio());
```

The underlying `socket.io` Server instance is accessible via `app.get('socketio')`.

### Socket event protocol

#### Client → server (service method calls)

All calls — standard and custom — use the same pattern. Implemented internally via `socket.onAny()`.

```typescript
// Signature
socket.emit(method, servicePath, ...args, callback)

// Standard methods
socket.emit('find',   'users', params,         (error, result) => { ... });
socket.emit('get',    'users', id, params,      (error, result) => { ... });
socket.emit('create', 'users', data, params,    (error, result) => { ... });
socket.emit('update', 'users', id, data, params,(error, result) => { ... });
socket.emit('patch',  'users', id, data, params,(error, result) => { ... });
socket.emit('remove', 'users', id, params,      (error, result) => { ... });

// Custom method (declared in app.use options.methods) — same shape as create
socket.emit('charge', 'payments', data, params, (error, result) => { ... });
```

Callbacks follow Node.js error-first convention: `(error: SerializedMantleError | null, result: T | null)`.

Custom methods are routed via `ServiceHandle.dispatch(method, data, undefined, params)`. Methods not in the service's declared `methods` list are rejected with a `GeneralError`.

#### Server → client (service events)

Emitted automatically after successful mutating operations. **Fires for any transport** (REST or socket) via the `'service:event'` app bus:

```typescript
// Event name format: '<servicePath> <eventName>'
socket.on('users created',  (data: User) => { ... });
socket.on('users updated',  (data: User) => { ... });
socket.on('users patched',  (data: User) => { ... });
socket.on('users removed',  (data: User) => { ... });
```

A REST `POST /users` triggers `users created` on all socket clients automatically.

#### Channel-based broadcasting

Broadcasting is **opt-in**: if no publisher is configured for a service (and no global publisher), service events are silently dropped — no clients receive them.

Resolution order when a `'service:event'` fires:
1. Look up `app.service(path).publisher` — per-service publisher
2. Fall back to `app.get('__globalPublisher')` — global publisher
3. If neither: drop (no broadcast)

The publisher is called with `(result, { app, path, params })` and returns one or more `MantleChannel` instances. The socketio plugin iterates each channel's `connections`, applies any `filter()` predicate, deduplicates by socket ID, and calls `socket.emit(eventName, result)` on each matching live socket.

**Channel implementations in `@mantlejs/socketio`:**

| Class | Purpose |
|---|---|
| `Channel` | Named, mutable set of connections |
| `FilteredChannel` | Wraps a channel, applies predicate at broadcast time |
| `CombinedChannel` | Union of multiple channels (returned by `app.channel([...])`) |
| `ChannelRegistry` | Holds all named channels; installed on app via `__channelFactory` |

Connection objects include a `__socketId` field (set by the plugin) used to look up the live socket via `io.sockets.sockets.get(socketId)`.

**App-level connection events:**

```typescript
// Emitted by the socketio plugin on every socket connect/disconnect
app.emit('connection', connection);   // connection: Record<string, unknown>
app.emit('disconnect', connection);
```

On disconnect, `ChannelRegistry.removeConnection(connection)` is called automatically, removing the connection from every named channel.

#### Per-connection state

Each socket gets a persistent `connection` object available to hooks as `params.connection`:

```typescript
params.connection  // Record<string, unknown>, lives for the socket's lifetime
```

Hooks can store auth state, preferences, or any per-user data on this object and access it on subsequent calls without re-fetching.

### `params.provider` for socket calls

```typescript
params.provider === 'socket.io'
```

Hooks can use `params.provider` to apply different logic for REST vs socket calls.

### Error serialization over sockets

Socket.io errors are serialized using `MantleError.toJSON()`. Plain `Error` instances are wrapped in `GeneralError` before serializing:

```typescript
{
  name: 'NotAuthenticated',
  message: 'Not authenticated',
  code: 401,
  className: 'not-authenticated',
  data: undefined,
  errors: []
}
```

---

## Public API Surface — `@mantlejs/storage-s3`

### Exports

```typescript
export function s3Storage(config: S3StorageConfig): StorageAdapter;
export interface S3StorageConfig { ... }
```

### `s3Storage(config)`

```typescript
function s3Storage(config: S3StorageConfig): StorageAdapter;

interface S3StorageConfig {
  bucket: string;
  region: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  keyPrefix?: string;           // Default: ''
  acl?: 'private' | 'public-read';  // Default: 'private'
  key?: (file: IncomingFile) => string;
}
```

The `key` function defaults to: `[keyPrefix/]${Date.now()}-${file.originalname}`

`UploadedFile.path` after storage: `https://{bucket}.s3.{region}.amazonaws.com/{key}`

Uses `@aws-sdk/lib-storage` `Upload` for multipart upload, supporting files of any size.

---

## Public API Surface — `@mantlejs/storage-gcs`

### Exports

```typescript
export function gcsStorage(config: GCSStorageConfig): StorageAdapter;
export interface GCSStorageConfig { ... }
```

### `gcsStorage(config)`

```typescript
function gcsStorage(config: GCSStorageConfig): StorageAdapter;

interface GCSStorageConfig {
  bucket: string;
  projectId?: string;
  keyFilename?: string;          // Default: uses Application Default Credentials
  keyPrefix?: string;            // Default: ''
  public?: boolean;              // Default: false
  key?: (file: IncomingFile) => string;
}
```

`UploadedFile.path` after storage:
- `public: true` → `https://storage.googleapis.com/{bucket}/{key}`
- `public: false` → `gs://{bucket}/{key}` (use for server-side access or signed URL generation)

---

## Public API Surface — `@mantlejs/cli`

The CLI has no importable TypeScript API. It is a binary (`mantle`) distributed as an npm package.

### Commands

```bash
mantle new <project-name> [options]
mantle generate <generator> <name> [options]
mantle g <generator> <name> [options]      # shorthand
```

### `mantle new` options

```
--transport <transport>    HTTP transport. Default: express
--database <db>            Database adapter. Choices: pg, sqlite, none. Default: pg
--auth <auth>              Auth strategy. Choices: local, google, github, none. Default: local
--packageManager <pm>      Choices: npm, yarn, pnpm. Default: npm
--skip-install             Scaffold files only, do not run install
```

### `mantle generate` generators

| Generator | Alias | Output |
|---|---|---|
| `service` | `s` | `<name>.service.ts`, `<name>.repository.ts`, `<name>.schema.ts`, `<name>.service.spec.ts` |
| `hook` | `h` | `<name>.hook.ts`, `<name>.hook.spec.ts` |
| `repository` | `r` | `<name>.repository.ts` |

### Generator output location

All generators write to `src/services/<name>/` by default. Override with `--directory <path>`.

### Generated test convention

Service tests generated by `mantle g service` use `@mantlejs/memory` as the repository:

```typescript
// <name>.service.spec.ts (generated)
import { MemoryRepository } from '@mantlejs/memory';
import { UserService } from './<name>.service';

describe('UserService', () => {
  let repo: MemoryRepository<User>;
  let service: UserService;

  beforeEach(() => {
    repo = new MemoryRepository<User>();
    service = new UserService(repo);
  });

  it('creates a user', async () => {
    const user = await service.create({ email: 'a@b.com', name: 'Alice' }, {});
    expect(user.id).toBeDefined();
    expect(user.email).toBe('a@b.com');
  });
});
```

---

## Request Lifecycle Additions

### Lifecycle with Logging and Schema Validation

The following traces a `POST /users` request through a Phase 2 application with logging and schema validation enabled.

```
Client
  │
  │  POST /users  { email: "not-an-email", name: "" }
  │  X-Correlation-ID: a3f2c1d4-...   (optional — generated if absent)
  ▼
@mantlejs/express  (Transport Layer)
  │  • Reads (or generates) X-Correlation-ID
  │  • Sets X-Correlation-ID response header
  │  • Calls withContext({ correlationId }, next) — context propagates through entire request
  │  • Matches route to service: 'users' → create method
  │  • Parses body, maps req → ServiceParams
  │  • Sets params.provider = 'rest'
  ▼
Hook Pipeline — BEFORE
  │  • logRequest()          starts timer, records method + path
  │  • validate(UserSchema)  checks data against TypeBox schema
  │       email → fails format 'email'
  │       name  → fails minLength 1
  │       throws Unprocessable({ errors: [{ field: '/email', ... }, { field: '/name', ... }] })
  ▼
Hook Pipeline — ERROR (short-circuit — service never called)
  │  • logRequest()          stops timer, logs debug record:
  │       { correlationId: 'a3f2c1d4-...', component: 'mantle:request',
  │         method: 'create', path: 'users', durationMs: 1, status: 'error' }
  │  • logError()            logs warn-level record:
  │       { correlationId: 'a3f2c1d4-...', component: 'mantle:error',
  │         method: 'create', code: 422, name: 'Unprocessable' }
  ▼
@mantlejs/express error handler
  │  • Serializes via MantleError.toJSON()
  │  • HTTP 422 Unprocessable Entity
  ▼
Client
     HTTP 422  { name: 'Unprocessable', code: 422, data: { errors: [...] } }
```

**Happy path — valid data:**

```
Hook Pipeline — BEFORE
  │  • logRequest()           starts timer
  │  • validate(UserSchema)   passes — data is valid
  │  • hashPassword()         hashes data.password
  ▼
Service.create(data, params)
  │  • calls UserRepository.save(data)
  ▼
UserRepository.save(data)   (KnexRepository → PostgreSQL)
  │  • INSERT ... RETURNING *
  │  • returns User entity
  ▼
Hook Pipeline — AFTER
  │  • resolver<User>({ password: () => undefined })
  │       strips password field
  │  • logRequest()   stops timer, logs debug record:
  │       { correlationId: 'a3f2c1d4-...', component: 'mantle:request',
  │         durationMs: 14, status: 'ok' }
  ▼
@mantlejs/express
  │  • HTTP 201 Created
  ▼
Client
     HTTP 201  { id, email, name, createdAt, updatedAt }
```

---

### Socket.io Real-Time Event Lifecycle

The following traces a Socket.io `create` call and the resulting broadcast event. The broadcast flows through the core event bus, not directly from the socket handler — which is why REST mutations also trigger socket events.

```
Socket.io Client A                    Socket.io Client B (listener)
  │                                         │
  │  socket.emit('create', 'messages',       │
  │    { text: 'Hello' }, {}, callback)      │
  ▼                                         │
@mantlejs/socketio  (Transport Layer)        │
  │  • socket.onAny() handler fires          │
  │  • Sets params.provider = 'socket.io'   │
  │  • Attaches params.connection (per-socket state)
  ▼                                         │
Hook Pipeline — BEFORE                       │
  │  • authenticate('jwt')                   │
  │       verifies params.headers.authorization token
  │       sets params.user                  │
  ▼                                         │
Service.create(data, params)                 │
  ▼                                         │
Repository.save(data) → Message entity       │
  ▼                                         │
Hook Pipeline — AFTER                        │
  │  • (any after hooks)                     │
  ▼                                         │
@mantlejs/mantle — ServiceHandleImpl           │
  │  • app.emit('service:event',             │
  │      'messages', 'created', result, params)
  ▼                                         │
@mantlejs/socketio — app event listener      │
  │  • resolves publisher:                  │
  │      1. service.publisher (per-service) │
  │      2. app.__globalPublisher (fallback)│
  │      3. neither → drop (opt-in)         │
  │  • publisher(result, ctx) → channel(s)  │
  │  • for each connection in channel:      │
  │      apply filter predicate if any      │
  │      io.sockets.sockets.get(socketId)   │
  │      .emit('messages created', result) →→ Client B receives event
  ▼                                         ▼
@mantlejs/socketio — socket handler          │
  │  • callback(null, message)  →→→→→→→→  Client A receives acknowledgement
```

**Key design properties:**
- The socket handler calls `callback` with the result (acknowledgement for Client A).
- The broadcast to all other clients (Client B) flows through `app.emit('service:event', ...)` in core and the channel publisher system in socketio — not from the socket handler directly.
- This means a REST `POST /messages` follows the same path from `Service.create(data, params)` onward — the socket broadcast happens automatically through channels.
- Broadcasting is opt-in: if no publisher is declared, service events are silently dropped. This is the primary security mechanism — clients only receive what the publisher explicitly returns.
- On disconnect, connections are automatically removed from all named channels.
