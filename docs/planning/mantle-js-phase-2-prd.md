# Product Requirements Document
# Mantle JS — Phase 2

**Version:** 0.2.0-draft
**Status:** In Review
**License:** MIT
**Last Updated:** 2026-06-20
**Companion:** [Mantle JS Phase 1 PRD](./mantle-js-phase-1-prd.md)

---

## Table of Contents

1. [Overview](#overview)
2. [Goals & Non-Goals](#goals--non-goals)
3. [Phase 2 Package Specifications](#phase-2-package-specifications)
4. [Package Structure Additions](#package-structure-additions)
5. [Developer Experience Principles](#developer-experience-principles)
6. [Success Metrics](#success-metrics)
7. [Architectural & Design Decisions](#architectural--design-decisions)

---

## Overview

Phase 1 gave developers a working REST API with PostgreSQL persistence and local password authentication. Phase 2 makes that API **production-ready, developer-friendly, and real-time capable**.

Phase 2 delivers eight new packages and one additive change to `@mantlejs/mantle`:

| Package | Purpose |
|---|---|
| `@mantlejs/mantle` (updated) | Adds the `Logger` interface — zero deps, no implementation |
| `@mantlejs/logger` | Pino adapter + `logRequest` / `logError` hook factories |
| `@mantlejs/schema` | TypeBox-based schema definition, validation, and data resolution |
| `@mantlejs/memory` | In-memory `Repository<T>` for unit testing and prototyping |
| `@mantlejs/config` | Environment-aware config loading with optional schema validation |
| `@mantlejs/auth-google` | OAuth 2.0 Google Sign-In strategy |
| `@mantlejs/auth-github` | OAuth 2.0 GitHub strategy |
| `@mantlejs/socketio` | Socket.io real-time transport adapter |
| `@mantlejs/upload-s3` | AWS S3 storage adapter for `@mantlejs/upload` |
| `@mantlejs/upload-gcs` | Google Cloud Storage adapter for `@mantlejs/upload` |
| `@mantlejs/cli` | Developer CLI: `mantle new` and `mantle generate` |

---

## Goals & Non-Goals

### Goals

- Add structured, pluggable logging as a first-class concept — `Logger` interface in core, pino adapter in `@mantlejs/logger`
- Provide TypeBox-based schema validation and type inference via `@mantlejs/schema`
- Ship a CLI for project scaffolding and code generation (`@mantlejs/cli`)
- Add cloud storage adapters (S3, GCS) for `@mantlejs/upload`
- Provide an in-memory repository for unit testing with no database dependency
- Add environment-aware configuration management with optional schema validation
- Support OAuth 2.0 authentication via Google and GitHub strategies
- Enable real-time service events via a Socket.io transport adapter

### Non-Goals (Phase 2)

- No GraphQL transport
- No raw WebSocket or SSE transport (Socket.io only for real-time)
- No Koa HTTP adapter (Phase 3)
- No client SDKs for React, Vue, iOS, Android (Phase 3)
- No cross-instance event replication (`@mantlejs/sync` — Phase 3)
- No MongoDB or Prisma adapters (Phase 3)
- No multi-tenancy primitives (Phase 4)
- No OpenAPI/Swagger auto-generation (Phase 4)
- No rate limiting plugin (Phase 4)
- No log file rotation — infrastructure concern, not the application's responsibility

---

## Phase 2 Package Specifications

---

### `@mantlejs/mantle` — Logger Interface (additive)

A minimal `Logger` interface is added to core. It creates a stable contract for all Mantle packages — first-party and third-party — to emit diagnostic output without coupling to any specific logging library.

The interface is intentionally narrow and compatible with the APIs of popular loggers (pino, winston) with minimal or no adaptation required.

```typescript
interface Logger {
  debug(msg: string, context?: Record<string, unknown>): void;
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  error(msg: string, context?: Record<string, unknown>): void;
}
```

**Registration:** `app.set('logger', logger)` / `app.get('logger')`

**Behavior when no logger is configured:** `app.get('logger')` returns `undefined`. All internal Mantle logging uses optional chaining (`app.get('logger')?.debug(...)`) — if no logger is configured, logging is silently skipped. Zero overhead, zero noise for developers who opt out.

**Log levels used by Mantle packages internally:**

| Level | Used for |
|---|---|
| `debug` | Service registration, hook execution details, query params |
| `info` | Server start/stop, database connection established |
| `warn` | Deprecated API usage, retried operations |
| `error` | Unhandled errors, connection failures |

**Debug verbosity:** Controlled by the `LOG_LEVEL` environment variable. Mantle does not use the `debug` npm library or `DEBUG=*` namespace filtering. All internal logs include a `component` field (e.g. `mantle:core`, `mantle:knex`) for filtering at the log aggregation layer without restarting the application.

```bash
LOG_LEVEL=debug npm start   # debug + info + warn + error
LOG_LEVEL=info npm start    # info + warn + error  (production default)
LOG_LEVEL=warn npm start    # warn + error only
```

### `@mantlejs/mantle` — Application event bus (additive)

A lightweight event bus is added to `MantleApplication`. Uses Node.js `EventEmitter` internally — zero new dependencies.

```typescript
interface MantleApplication {
  // ...existing...
  on(event: string, listener: (...args: unknown[]) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this;
  emit(event: string, ...args: unknown[]): void;
}
```

After every successful service mutation (`create`, `update`, `patch`, `remove`), core emits a `'service:event'` on the application, regardless of which transport triggered the call:

```typescript
app.emit('service:event', path, eventName, result, params);
// e.g. app.emit('service:event', 'users', 'created', newUser, { provider: 'rest', ... })
```

`@mantlejs/socketio` subscribes to this once and fans out to connected socket clients, giving REST mutations automatic real-time broadcast with no extra wiring.

`ServiceHandle` also exposes `readonly methods: string[]` — the list of methods (standard and custom) allowed on that service. Transports use this for routing decisions.

### `@mantlejs/mantle` — `ServiceParams` additions (additive)

Two new optional fields on `ServiceParams`, both recognised by `@mantlejs/socketio`:

```typescript
interface ServiceParams {
  // ...existing...
  connection?: Record<string, unknown>; // per-socket persistent state
  rooms?: string | string[];            // if set, broadcast only to these socket.io rooms
}
```

### `@mantlejs/mantle` — Request Context (additive)

An `AsyncLocalStorage`-based request context is added to core. Uses Node.js built-ins — zero new dependencies.

```typescript
interface RequestContext {
  correlationId: string;
  [key: string]: unknown;
}

function withContext<T>(context: RequestContext, fn: () => T): T;
function getContext(): RequestContext | undefined;
```

`withContext` runs `fn` inside an `AsyncLocalStorage` scope; all async operations spawned within `fn` inherit the context. The `express()` plugin uses `withContext` automatically — one `correlationId` per HTTP request, read from the `X-Correlation-ID` header or generated as a UUID. `getContext()` returns `undefined` outside a scope (e.g. direct internal service calls). Hooks and adapters can call `getContext()` to read the correlation ID without it being threaded explicitly through every function signature.

---

### `@mantlejs/logger`

Pino adapter for the Mantle `Logger` interface plus two built-in hook factories for request and error logging.

**Dependencies:** `@mantlejs/mantle`, `pino`

#### `logger()` plugin factory

Accepts a pino instance (or any object satisfying the `Logger` interface) and registers it on the application.

```typescript
function logger(adapter: Logger): MantlePlugin;
```

The pino adapter ships as a named export and handles pino's argument-order difference internally (`logger.info(obj, msg)` vs the interface's `logger.info(msg, obj)`). It also automatically merges the current `RequestContext` (including `correlationId`) into every log record via `getContext()` — no manual threading required.

```typescript
import pino from 'pino';
import { logger, pinoAdapter } from '@mantlejs/logger';

app.configure(logger(pinoAdapter(pino({ level: process.env.LOG_LEVEL ?? 'info' }))));
```

#### Winston / custom logger

Winston satisfies the `Logger` interface natively — no adapter or `@mantlejs/logger` package required:

```typescript
import winston from 'winston';
const winstonLogger = winston.createLogger({ /* ... */ });
app.set('logger', winstonLogger);
```

Any object with `debug`, `info`, `warn`, and `error` methods matching the interface signature works directly.

#### `logRequest()` hook

Logs one record per service call including duration. Register the **same returned function** in `before.all`, `after.all`, **and** `error.all`. The before phase records the start time; the after or error phase emits the record with elapsed duration and status (`'ok'` or `'error'`).

```typescript
function logRequest(options?: LogRequestOptions): HookFunction;

interface LogRequestOptions {
  /** Log level for calls. Default: 'debug' */
  level?: 'debug' | 'info';
  /** Include params in log record. Default: false — may contain sensitive data */
  includeParams?: boolean;
}
```

Emitted record shape (success):

```json
{
  "correlationId": "a3f2c1d4-...",
  "component": "mantle:request",
  "method": "get",
  "path": "users",
  "provider": "rest",
  "id": "42",
  "durationMs": 12,
  "status": "ok"
}
```

On error, `status` is `"error"`, the message is `"Service call failed"`, and `id` is included when present. `correlationId` is only present when using `pinoAdapter` inside an Express request.

#### `logError()` hook

Error hook. Logs structured error details. Maps 4xx to `warn`, 5xx to `error` by default.

```typescript
function logError(options?: LogErrorOptions): HookFunction;

interface LogErrorOptions {
  /** Log 4xx as 'warn', 5xx as 'error'. Default: true */
  levelByCode?: boolean;
  /** Include stack trace. Default: NODE_ENV !== 'production' */
  includeStack?: boolean;
}
```

Emitted record shape:

```json
{
  "component": "mantle:error",
  "method": "create",
  "path": "users",
  "provider": "rest",
  "code": 409,
  "name": "Conflict",
  "message": "Email already exists",
  "stack": "..."
}
```

#### Typical setup

```typescript
import pino from 'pino';
import { logger, pinoAdapter, logRequest, logError } from '@mantlejs/logger';

app.configure(logger(pinoAdapter(pino({ level: process.env.LOG_LEVEL ?? 'info' }))));

const requestLogger = logRequest();

app.service('users').hooks({
  before: { all: [requestLogger] },
  after:  { all: [requestLogger] },
  error:  { all: [requestLogger, logError()] },
});
```

#### Output destination

Destination is configured on the pino instance itself — not a Mantle concern:

```typescript
// stdout only (cloud-native default — recommended for EKS, Cloud Run)
pino({ level: 'info' })

// file only
pino({}, pino.destination('/var/log/app.log'))

// stdout + file simultaneously
pino({ level: 'info' }, pino.multistream([
  { stream: process.stdout },
  { stream: pino.destination('/var/log/app.log') },
]))
```

**Log rotation is not the application's concern.** In containers (EKS, Cloud Run), the container runtime and log agents (fluentd, fluent-bit, CloudWatch) handle collection and rotation from stdout. If writing to files, configure rotation at the infrastructure level (`logrotate`, a sidecar log shipper). Mantle does not implement log rotation.

---

### `@mantlejs/schema`

TypeBox schema definition, Ajv validation, and data resolution for Mantle services.

**Dependencies:** `@mantlejs/mantle`, `@sinclair/typebox`, `ajv`, `ajv-formats`

**Why TypeBox?** A single schema definition generates both a TypeScript type and a JSON Schema object. No code generation step, no build pipeline, no external schema files — just TypeScript. Compatible with all JSON Schema validators and OpenAPI tooling.

**Why Ajv?** TypeBox's built-in `Value.Check` is convenient but uses simple heuristics for string format validation. Ajv with `ajv-formats` provides RFC-compliant implementations for `email`, `date-time`, `uuid`, `ipv6`, and other common formats. It is the de facto standard JSON Schema validator in the Node.js ecosystem.

#### Schema definition

`@mantlejs/schema` re-exports TypeBox, so developers import from one place:

```typescript
import { Type, Static } from '@mantlejs/schema';

const UserSchema = Type.Object({
  id:        Type.String({ format: 'uuid' }),
  email:     Type.String({ format: 'email' }),
  name:      Type.String({ minLength: 1, maxLength: 100 }),
  password:  Type.Optional(Type.String({ minLength: 8 })),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

type User = Static<typeof UserSchema>;
```

#### `validate()` hook

Validates `context.data` (before hooks), `context.result` (after hooks), or `context.params.query` against a TypeBox schema using Ajv. Throws `Unprocessable` with field-level error details on failure. Compiled validators are cached per schema reference — Ajv compiles once on first use, not per request.

```typescript
function validate<T extends TSchema>(schema: T, options?: ValidateOptions): HookFunction;

interface ValidateOptions {
  /** What to validate. Default: 'data' */
  target?: 'data' | 'result' | 'query';
  /** Coerce string inputs to their schema types (e.g. "42" → 42). Default: false */
  coerce?: boolean;
  /** Strip properties not declared in the schema. Default: false */
  stripAdditional?: boolean;
}
```

`coerce` and `stripAdditional` use TypeBox's `Value.Convert` and `Value.Clean` as pre-processing steps before Ajv validates the result. The transformed value is written back to the context target.

Validation error format:

```typescript
throw new Unprocessable('Validation failed', {
  errors: [
    { field: '/email', message: 'must match format "email"' },
    { field: '/name',  message: 'must NOT have fewer than 1 characters' },
  ],
});
```

#### BYOV — bring your own validator

Pass a function as the first argument instead of a schema to bypass the Ajv path entirely:

```typescript
type ValidatorFn = (data: unknown) => Array<{ field: string; message: string }> | null | undefined;

function validate(validator: ValidatorFn, options?: Pick<ValidateOptions, 'target'>): HookFunction;
```

This enables using Zod, Valibot, or any other validation library while keeping the same `Unprocessable` error shape:

```typescript
import { z } from "zod";
import type { ValidatorFn } from "@mantlejs/schema";

const UserZod = z.object({ email: z.string().email(), name: z.string().min(1) });
const zodValidator: ValidatorFn = (data) => {
  const result = UserZod.safeParse(data);
  if (result.success) return null;
  return result.error.issues.map((i) => ({ field: '/' + i.path.join('/'), message: i.message }));
};

app.service('users').hooks({ before: { create: [validate(zodValidator)] } });
```

Note: Ajv is a hard dependency of `@mantlejs/schema`. BYOV replaces the validation logic, not the package dependency.

#### `resolver()` hook

Transforms data after the service method runs — strip sensitive fields, compute derived values, or join related records. Field resolvers returning `undefined` remove the field from the output. Supports single records, arrays, and `Paginated<T>`.

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

**Shared context:** `createContext` is called once per record. Its return value is passed to every field resolver as the fourth argument. Use this to avoid repeating expensive async lookups across multiple fields:

```typescript
app.service('users').hooks({
  after: {
    all: [
      resolver<User, { isAdmin: boolean }>(
        {
          password: () => undefined,                               // always strip
          role: (_, data, ctx, shared) => shared.isAdmin ? data.role : 'viewer',
          fullName: (_, data) => `${data.firstName} ${data.lastName}`,
        },
        { createContext: async (record) => ({ isAdmin: await checkAdmin(record.id) }) },
      ),
    ],
  },
});
```

Existing field resolvers with fewer than four parameters continue to work — TypeScript allows functions to ignore trailing arguments.

#### Schema registration on a service

An optional `schema` option on `app.use()` stores the schema for future tooling (CLI introspection, OpenAPI generation in Phase 4):

```typescript
app.use('/users', new UserService(new UserRepository(app)), {
  methods: ['find', 'get', 'create', 'update', 'patch', 'remove'],
  schema: UserSchema,
});

// Accessible as:
app.service('users').schema; // → TSchema | undefined
```

---

### `@mantlejs/memory`

In-memory `Repository<T>` implementation. Intended for unit tests and rapid prototyping. Ships as a standalone package to keep `@mantlejs/mantle` dependency-free and focused.

**Dependencies:** `@mantlejs/mantle` only. Zero external runtime dependencies.

```typescript
class MemoryRepository<T extends Record<string, unknown>> implements Repository<T> {
  constructor(options?: MemoryRepositoryOptions);

  // Full Repository<T> implementation backed by a Map<Id, T>
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
  /** Primary key field name. Default: 'id' */
  idField?: string;
  /** Auto-generate string UUIDs for new records. Default: true */
  autoId?: boolean;
  /** Auto-manage createdAt / updatedAt timestamps. Default: true */
  timestamps?: boolean;
}
```

All `QueryParams` operators supported in-memory — same filter API as `KnexRepository` so tests are interchangeable with production repositories.

#### Typical usage in tests

```typescript
import { MemoryRepository } from '@mantlejs/memory';

const repo = new MemoryRepository<User>();
repo.seed([
  { id: '1', email: 'alice@example.com', name: 'Alice' },
]);

const service = new UserService(repo);
const user = await service.get('1', {});
expect(user.name).toBe('Alice');
```

---

### `@mantlejs/config`

Environment-aware configuration management. Loads JSON config files from a `config/` directory, merges them with environment-specific overrides, and optionally validates the result against a TypeBox schema at startup.

**Dependencies:** `@mantlejs/mantle`, `@sinclair/typebox` (optional peer for schema validation)

#### `config()` plugin factory

```typescript
function config(options?: ConfigOptions): MantlePlugin;

interface ConfigOptions {
  /** Directory containing config files. Default: process.cwd() + '/config' */
  directory?: string;
  /** TypeBox schema for startup validation. Throws GeneralError if invalid. */
  schema?: TSchema;
  /** Environment variable that selects the environment overlay. Default: 'NODE_ENV' */
  envVar?: string;
}
```

#### Config file loading order

Files are merged in order — later values override earlier ones:

1. `config/default.json` — base config present in all environments
2. `config/{NODE_ENV}.json` — environment-specific overrides (e.g. `config/production.json`)
3. Environment variable overrides — any env var prefixed with `MANTLE_` is merged (uppercased, underscore-separated key path)

#### Accessing config

After configuring, the merged object is stored via `app.set('config', ...)`:

```typescript
// Read the whole config
const cfg = app.get<AppConfig>('config');

// Config keys are also set individually on app
const port = app.get<number>('port');
```

#### Example

```json
// config/default.json
{
  "port": 3030,
  "db": { "client": "pg", "pool": { "min": 2, "max": 10 } }
}

// config/production.json
{
  "port": 8080,
  "db": { "pool": { "max": 25 } }
}
```

```typescript
import { Type } from '@mantlejs/schema';

const AppConfigSchema = Type.Object({
  port: Type.Number(),
  db: Type.Object({
    client: Type.String(),
    pool: Type.Object({ min: Type.Number(), max: Type.Number() }),
  }),
});

app.configure(config({ schema: AppConfigSchema }));
// Throws GeneralError on startup if config doesn't match schema
```

---

### `@mantlejs/auth-google`

OAuth 2.0 Google Sign-In strategy for `@mantlejs/auth`. Implements the authorization code flow. No Passport.js dependency.

**Dependencies:** `@mantlejs/mantle`, `@mantlejs/auth`

```typescript
function googleStrategy(config: GoogleStrategyConfig): MantlePlugin;

interface GoogleStrategyConfig {
  /** Google OAuth client ID */
  clientId: string;
  /** Google OAuth client secret */
  clientSecret: string;
  /** Redirect URI registered in Google Cloud Console. Default: '/auth/google/callback' */
  callbackUrl?: string;
  /** OAuth scopes. Default: ['openid', 'profile', 'email'] */
  scope?: string[];
  /** Service used to find or create users. Default: 'users' */
  entity?: string;
  /** Field matched against Google's `sub` (subject) claim. Default: 'googleId' */
  entityIdField?: string;
}
```

#### Routes registered automatically

| Method | Route | Description |
|---|---|---|
| GET | `/auth/google` | Redirect to Google OAuth consent screen |
| GET | `/auth/google/callback` | Handle callback, create/find user, issue Mantle JWT |

#### Auth flow

1. User navigates to `GET /auth/google`
2. App redirects to Google with client ID, scopes, and state
3. User grants consent; Google redirects to `/auth/google/callback?code=...`
4. App exchanges code for Google tokens, fetches the user's profile
5. App finds or creates a user record via `app.service(entity)`
6. App issues a Mantle access + refresh token pair
7. Tokens returned as JSON (API flow) or via redirect (browser flow — configurable)

On successful authentication, the response matches the local auth shape:

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "user": { "id": "...", "email": "...", "name": "..." }
}
```

---

### `@mantlejs/auth-github`

OAuth 2.0 GitHub strategy. Follows the same pattern as `@mantlejs/auth-google`.

**Dependencies:** `@mantlejs/mantle`, `@mantlejs/auth`

```typescript
function githubStrategy(config: GithubStrategyConfig): MantlePlugin;

interface GithubStrategyConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl?: string;
  /** OAuth scopes. Default: ['user:email'] */
  scope?: string[];
  entity?: string;
  /** Field matched against GitHub's user ID. Default: 'githubId' */
  entityIdField?: string;
}
```

#### Routes registered automatically

| Method | Route | Description |
|---|---|---|
| GET | `/auth/github` | Redirect to GitHub authorization page |
| GET | `/auth/github/callback` | Handle callback, create/find user, issue Mantle JWT |

---

### `@mantlejs/socketio`

Socket.io transport adapter. Runs on the same HTTP server as `@mantlejs/express`, giving services a real-time event channel alongside their REST API.

**Dependencies:** `@mantlejs/mantle`, `socket.io`

```typescript
function socketio(options?: SocketioOptions): MantlePlugin;

interface SocketioOptions {
  /** Passed directly to the socket.io Server constructor */
  serverOptions?: Partial<ServerOptions>;
  /** Milliseconds before a socket call times out. Default: 30000 */
  timeout?: number;
  /** Path for socket.io server. Default: '/socket.io' */
  path?: string;
}
```

#### Service method calls over sockets

Clients call service methods by emitting named events. Standard and custom methods share the same protocol:

```
socket.emit('<method>', '<service>', <data|id|null>, <params>, callback)
```

| Emit event | Service method called |
|---|---|
| `'find'` | `service.find(params)` |
| `'get'` | `service.get(id, params)` |
| `'create'` | `service.create(data, params)` |
| `'update'` | `service.update(id, data, params)` |
| `'patch'` | `service.patch(id, data, params)` |
| `'remove'` | `service.remove(id, params)` |
| `'<customMethod>'` | `service.dispatch(method, data, undefined, params)` |

Custom methods must be declared in `app.use()` options and are routed via `ServiceHandle.dispatch()`.

#### Service events (server → client)

After a successful mutating operation — via **any transport** (REST or socket) — all connected socket clients receive the event:

| Service method | Emitted event |
|---|---|
| `create` | `<service> created` |
| `update` | `<service> updated` |
| `patch` | `<service> patched` |
| `remove` | `<service> removed` |

```typescript
// Client
socket.on('users created', (user) => {
  console.log('New user:', user);
});
```

This means a `POST /users` over REST also triggers `users created` on all socket clients — no separate event wiring needed.

#### Channel-based broadcasting (opt-in security)

`@mantlejs/socketio` implements a channel system for controlling which socket clients receive service events. By default, **no events are broadcast** unless a publisher is declared — this is an opt-in security model.

**Joining channels:** When a socket connects, the app emits a `'connection'` event. Use this to place the connection in channels:

```typescript
app.on('connection', (connection) => {
  app.channel('anonymous').join(connection);
});
```

**Publishers:** Declare which channel(s) receive events per service (or globally):

```typescript
// Per-service publisher
app.service('messages').publish((data, ctx) => {
  return app.channel('authenticated');
});

// Global fallback — used when no per-service publisher is set
app.publish((data, ctx) => {
  return app.channel('authenticated');
});
```

If neither is set, the event is silently dropped — clients receive nothing. Per-service publishers take precedence over the global fallback.

**Filtering:** Publishers can return a filtered view of a channel — useful for per-user or per-tenant data isolation:

```typescript
app.service('users').publish((data, ctx) => {
  return app.channel('authenticated').filter((d, connection) => {
    return (connection.user as User)?.id === (d as User).id;
  });
});
```

**Combined channels:** Publishers can return multiple channels or use `app.channel([...])` for the union:

```typescript
app.service('messages').publish((data, ctx) => {
  return [app.channel('admins'), app.channel(`org:${(data as Message).orgId}`)];
});
```

**Channel lifecycle events:**

| Event | When emitted |
|---|---|
| `app.on('connection', cb)` | A new socket connects — use to join channels |
| `app.on('disconnect', cb)` | A socket disconnects — channel membership cleaned up automatically |

**MantleChannel interface:**

```typescript
interface MantleChannel {
  readonly connections: Record<string, unknown>[];
  join(connection: Record<string, unknown>): this;
  leave(connection: Record<string, unknown>): this;
  filter(fn: (data: unknown, connection: Record<string, unknown>) => boolean): MantleChannel;
}
```

**ChannelPublisher type:**

```typescript
type ChannelPublisher<T = unknown> = (
  data: T | T[] | Paginated<T>,
  context: { app: MantleApplication; path: string; params: ServiceParams },
) => MantleChannel | MantleChannel[] | null | undefined | void;
```

#### Per-socket connection state

Each socket connection gets a persistent `connection` object that lives for the duration of the connection. It is available to hooks as `params.connection`:

```typescript
app.service('messages').hooks({
  before: {
    all: [
      async (ctx) => {
        // Store auth result on first call, reuse on subsequent calls
        if (!ctx.params.connection?.user) {
          ctx.params.connection = { ...ctx.params.connection, user: await verifyToken(ctx) };
        }
        ctx.params.user = ctx.params.connection.user as Record<string, unknown>;
        return ctx;
      },
    ],
  },
});
```

#### Hook pipeline

The same Mantle hook pipeline runs for socket calls. `params.provider` is set to `'socket.io'`, allowing hooks to behave differently for REST vs real-time:

```typescript
app.service('messages').hooks({
  before: {
    all: [authenticate('jwt')],
  },
  after: {
    create: [
      // Only sanitize output for REST — socket clients may need raw data
      iff(isProvider('rest'), sanitizeUser()),
    ],
  },
});
```

#### Typical setup

```typescript
import { socketio } from '@mantlejs/socketio';

const app = mantle()
  .configure(express())
  .configure(socketio());

app.listen(3030);
// Both REST and Socket.io are active on port 3030
```

---

### `@mantlejs/upload-s3`

AWS S3 storage adapter for `@mantlejs/upload`. Replaces the local disk adapter with S3 object storage.

**Dependencies:** `@mantlejs/upload`, `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`

```typescript
function s3Storage(config: S3StorageConfig): StorageAdapter;

interface S3StorageConfig {
  /** S3 bucket name */
  bucket: string;
  /** AWS region (e.g. 'us-east-1') */
  region: string;
  /** Explicit credentials. Default: uses the AWS SDK default credential chain (IAM role, env vars, ~/.aws) */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  /** Key prefix applied to all uploaded objects. Default: '' */
  keyPrefix?: string;
  /** Canned ACL applied to uploaded objects. Default: 'private' */
  acl?: 'private' | 'public-read';
  /** Custom key generator. Default: `${keyPrefix}/${Date.now()}-${originalname}` */
  key?: (file: IncomingFile) => string;
}
```

After upload, `UploadedFile.path` is the full HTTPS URL:
`https://{bucket}.s3.{region}.amazonaws.com/{key}`

#### Usage

```typescript
import { upload } from '@mantlejs/upload';
import { s3Storage } from '@mantlejs/upload-s3';

app.configure(upload({
  storage: s3Storage({
    bucket: process.env.S3_BUCKET!,
    region: process.env.AWS_REGION!,
    keyPrefix: 'uploads',
  }),
  maxFileSize: 50 * 1024 * 1024, // 50MB
}));
```

---

### `@mantlejs/upload-gcs`

Google Cloud Storage adapter for `@mantlejs/upload`.

**Dependencies:** `@mantlejs/upload`, `@google-cloud/storage`

```typescript
function gcsStorage(config: GCSStorageConfig): StorageAdapter;

interface GCSStorageConfig {
  /** GCS bucket name */
  bucket: string;
  /** Google Cloud project ID */
  projectId?: string;
  /** Path to a service account key file. Default: uses Application Default Credentials (ADC) */
  keyFilename?: string;
  /** Key prefix applied to all uploaded objects. Default: '' */
  keyPrefix?: string;
  /** Make uploaded files publicly readable. Default: false */
  public?: boolean;
  /** Custom key generator. Default: `${keyPrefix}/${Date.now()}-${originalname}` */
  key?: (file: IncomingFile) => string;
}
```

After upload, `UploadedFile.path` is the HTTPS URL:
`https://storage.googleapis.com/{bucket}/{key}`

When `public: false` (default), the path is a GCS URI (`gs://`) suitable for server-side use or generating signed URLs.

---

### `@mantlejs/cli`

Developer scaffolding CLI. Generates new projects and service boilerplate consistent with Mantle's layered architecture.

**Installed globally or run via npx:**

```bash
npm install -g @mantlejs/cli
# or without installing:
npx @mantlejs/cli new my-api
```

#### Commands

```bash
mantle new <project-name>              # scaffold a new Mantle project
mantle generate service <name>         # generate a service, repository, and schema
mantle generate hook <name>            # generate a hook file
mantle generate repository <name>      # generate a repository file only
```

`generate` may be abbreviated to `g`:

```bash
mantle g service users
mantle g hook authenticate
```

#### `mantle new <project-name>`

Scaffolds a complete runnable project:

```
<project-name>/
├── src/
│   ├── app.ts               # Application bootstrap
│   ├── index.ts             # Entry point, app.listen()
│   └── services/
│       └── .gitkeep
├── config/
│   ├── default.json
│   └── production.json
├── package.json             # Pre-configured with @mantlejs/* dependencies
├── tsconfig.json
├── .env.example
├── .gitignore
└── README.md
```

The CLI prompts for:
- Transport (Express — only option in Phase 2)
- Database (PostgreSQL, SQLite, skip)
- Auth (local, Google, GitHub, none)
- Package manager (npm, yarn, pnpm)

#### `mantle g service <name>`

Generates a complete service scaffold in `src/services/<name>/`:

```
src/services/<name>/
├── <name>.service.ts        # class implementing Service<Entity>
├── <name>.repository.ts     # class extending KnexRepository<Entity>
├── <name>.schema.ts         # TypeBox schema + Static type (if @mantlejs/schema installed)
└── <name>.service.spec.ts   # Vitest unit test using MemoryRepository
```

The generated test file uses `@mantlejs/memory` so it runs without a database.

---

## Package Structure Additions

```text
mantle/
├── packages/
│   ├── core/              # @mantlejs/mantle        (Logger interface added)
│   ├── express/           # @mantlejs/express      (unchanged)
│   ├── knex/              # @mantlejs/knex         (unchanged)
│   ├── auth/              # @mantlejs/auth         (unchanged)
│   ├── auth-local/        # @mantlejs/auth-local   (unchanged)
│   ├── upload/            # @mantlejs/upload       (unchanged)
│   ├── logger/            # @mantlejs/logger       [NEW]
│   ├── schema/            # @mantlejs/schema       [NEW]
│   ├── memory/            # @mantlejs/memory       [NEW]
│   ├── config/            # @mantlejs/config       [NEW]
│   ├── auth-google/       # @mantlejs/auth-google  [NEW]
│   ├── auth-github/       # @mantlejs/auth-github  [NEW]
│   ├── socketio/          # @mantlejs/socketio     [NEW]
│   ├── upload-s3/         # @mantlejs/upload-s3    [NEW]
│   ├── upload-gcs/        # @mantlejs/upload-gcs   [NEW]
│   └── cli/               # @mantlejs/cli          [NEW]
```

### Updated Package Dependency Rules

| Package | May depend on |
|---|---|
| `@mantlejs/mantle` | nothing |
| `@mantlejs/express` | `@mantlejs/mantle` |
| `@mantlejs/knex` | `@mantlejs/mantle` |
| `@mantlejs/auth` | `@mantlejs/mantle` |
| `@mantlejs/auth-local` | `@mantlejs/mantle`, `@mantlejs/auth` |
| `@mantlejs/upload` | `@mantlejs/mantle` |
| `@mantlejs/logger` | `@mantlejs/mantle` |
| `@mantlejs/schema` | `@mantlejs/mantle` |
| `@mantlejs/memory` | `@mantlejs/mantle` |
| `@mantlejs/config` | `@mantlejs/mantle` |
| `@mantlejs/auth-google` | `@mantlejs/mantle`, `@mantlejs/auth` |
| `@mantlejs/auth-github` | `@mantlejs/mantle`, `@mantlejs/auth` |
| `@mantlejs/socketio` | `@mantlejs/mantle` |
| `@mantlejs/upload-s3` | `@mantlejs/upload` |
| `@mantlejs/upload-gcs` | `@mantlejs/upload` |
| `@mantlejs/cli` | nothing (code generator, no runtime imports) |

---

## Developer Experience Principles

Phase 2 upholds all Phase 1 principles and adds:

**7. Production-Ready by Default** — Phase 2 closes the gap between "it works locally" and "it runs in EKS or Cloud Run." Logging, config management, and cloud storage are shaped around container deployment patterns. The recommended defaults (`LOG_LEVEL=info`, stdout, `config/production.json`) require no code changes between environments.

**8. Progressive Validation** — Schema validation is opt-in and additive. A developer adds `validate(UserSchema)` to an existing service's hook list without touching service logic, repositories, or transport config.

**9. Test Without Infrastructure** — `@mantlejs/memory` provides a drop-in repository substitute so unit tests for services and hooks run without a database process. The CLI scaffolds tests this way by default.

---

## Success Metrics

| Metric | Phase 2 Target |
|---|---|
| npm weekly downloads (all packages combined) | 500+ within 60 days of Phase 2 launch |
| GitHub stars | 1000+ within 90 days |
| CLI: `mantle new` to first running API | < 5 minutes on a fresh machine |
| Schema validation errors | All errors include field path and human-readable message |
| Core + new package test coverage | > 90% |
| LOG_LEVEL switching | No code changes — env var only |
| Real-time events | Socket.io client receives `created` event within 50ms of REST `POST` |

---

## Architectural & Design Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Logger in core or standalone only? | Thin `Logger` **interface** in core (zero deps, no implementation). `@mantlejs/logger` ships the pino adapter and hooks. |
| 2 | `DEBUG=*` namespace vs `LOG_LEVEL`? | **`LOG_LEVEL` env var + `component` field** on records. No `debug` npm library. Filtering happens at the log aggregation layer, not the application. |
| 3 | Log file rotation? | **Not the application's concern.** Use `logrotate` or infrastructure tooling. Documented explicitly. |
| 4 | stdout vs file in containers? | **stdout is the default and the recommendation** for EKS/Cloud Run. Pino multistream supports file or stdout+file — configured on the pino instance, not by Mantle. |
| 5 | Winston compatibility? | **No adapter needed.** The `Logger` interface uses message-first signatures that winston satisfies natively. Pino requires the `pinoAdapter` wrapper to flip argument order. |
| 6 | Schema library? | **TypeBox** — generates TypeScript types and JSON Schema from one definition. No code generation. Re-exported from `@mantlejs/schema`. |
| 7 | Resolver pattern? | Simplified field-map resolver hook (`resolver<T>(map)`). Returning `undefined` removes the field. No separate data/result/query resolver classes as in FeathersJS. |
| 8 | Memory repo in core or separate? | **Separate `@mantlejs/memory`.** Core stays as the zero-dep kernel. |
| 9 | OAuth implementation? | **Direct OAuth 2.0 flow** per provider — no Passport.js dependency. Each strategy package owns its flow. |
| 10 | Socket.io channels? | **Implemented in Phase 2** in `@mantlejs/socketio`. Opt-in security model: no publisher = no broadcast. Uses `app.channel()`, `service.publish()`, and `app.publish()`. Filtered views via `channel.filter()`. Connection lifecycle via `app.on('connection'/'disconnect', ...)`. Cross-instance replication via `@mantlejs/sync` is Phase 3. |
| 11 | Cloud storage adapter naming? | **Separate installable packages:** `@mantlejs/upload-s3`, `@mantlejs/upload-gcs`. Users only install what they need. |
| 12 | Config file format? | **JSON only** for Phase 2. Simple to parse, no additional dependencies. YAML or JS config files can be added in a later phase. |
| 13 | Config validation at startup? | **Optional TypeBox schema.** If provided, invalid config throws `GeneralError` before the server starts — fail fast, fail loud. |
| 14 | Correlation ID threading? | **`AsyncLocalStorage` in `@mantlejs/mantle`** (`withContext` / `getContext`). Express middleware injects `correlationId` per request; `pinoAdapter` merges it into every record automatically. Hooks can read `getContext()` directly. No function-signature threading required. |
