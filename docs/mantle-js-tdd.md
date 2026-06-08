# Technical Design Document (Thin)
# Mantle JS — Phase 1

**Version:** 0.1.0-draft  
**Status:** In Progress  
**Companion:** [Mantle JS PRD v0.1.0]  
**Last Updated:** 2026-05-17

---

## Table of Contents

1. [Scope of This Document](#scope-of-this-document)
2. [Package Dependency Graph](#package-dependency-graph)
3. [Public API Surface — @mantlejs/core](#public-api-surface--mantlejscore)
4. [Public API Surface — @mantlejs/express](#public-api-surface--mantlejsexpress)
5. [Public API Surface — @mantlejs/postgresql](#public-api-surface--mantlejspostgresql)
6. [Public API Surface — @mantlejs/auth](#public-api-surface--mantlejsauth)
7. [Public API Surface — @mantlejs/auth-local](#public-api-surface--mantlejsauth-local)
8. [Public API Surface — @mantlejs/upload](#public-api-surface--mantlejsupload)
9. [Request Lifecycle (Data Flow)](#request-lifecycle-data-flow)
10. [Deferred to Full TDD](#deferred-to-full-tdd)

---

## Scope of This Document

This is a **thin TDD**. It covers:

- The package dependency graph (what depends on what)
- The exact public TypeScript API surface for each Phase 1 package
- A data flow walkthrough of a single HTTP request end-to-end

It does **not** cover internal implementation details, class internals, or infrastructure wiring — those will be documented as a full TDD once Phase 1 scaffolding is underway.

---

## Package Dependency Graph

### Dependency Rules

- Dependencies flow **outward to inward** — outer packages depend on inner packages, never the reverse
- `@mantlejs/core` has **zero** external runtime dependencies
- All other packages depend on `@mantlejs/core` and add their own peer/runtime dependencies
- Auth packages depend on each other (`auth-local` depends on `auth`) but not on transport or database packages
- Transport and database adapters are **independent of each other**

### Graph

```
@mantlejs/core
│   (no external deps)
│
├── @mantlejs/express
│       depends on: @mantlejs/core, express
│
├── @mantlejs/postgresql
│       depends on: @mantlejs/core, knex, pg
│
├── @mantlejs/auth
│       depends on: @mantlejs/core, jsonwebtoken
│
│   └── @mantlejs/auth-local
│           depends on: @mantlejs/core, @mantlejs/auth, bcrypt
│
└── @mantlejs/upload
        depends on: @mantlejs/core, busboy
```

### Matrix View

| Package | core | express | postgresql | auth | auth-local | upload |
|---|---|---|---|---|---|---|
| `@mantlejs/core` | — | | | | | |
| `@mantlejs/express` | ✅ | — | | | | |
| `@mantlejs/postgresql` | ✅ | | — | | | |
| `@mantlejs/auth` | ✅ | | | — | | |
| `@mantlejs/auth-local` | ✅ | | | ✅ | — | |
| `@mantlejs/upload` | ✅ | | | | | — |

> No package outside of `auth-local` depends on another non-core package. This keeps each adapter independently installable.

---

## Public API Surface — @mantlejs/core

### `mantle()`

Factory function. Creates and returns a `MantleApplication` instance.

```typescript
function mantle(options?: MantleOptions): MantleApplication;

interface MantleOptions {
  /** Default error handler. Defaults to true. */
  errorHandler?: boolean;
}
```

---

### `MantleApplication`

The top-level application instance.

```typescript
interface MantleApplication {
  /**
   * Register a service at a given path.
   * Options allow declaring which methods are exposed.
   */
  use(path: string, service: Partial<Service<any>>, options?: ServiceOptions): this;

  /**
   * Retrieve a registered service by path.
   * Throws NotFound if the service does not exist.
   */
  service<T = any>(path: string): ServiceHandle<T>;

  /**
   * Apply a plugin to this application.
   * A plugin is a function that receives and configures the app.
   */
  configure(plugin: MantlePlugin): this;

  /**
   * Get or set a named application-level setting.
   */
  set(key: string, value: unknown): this;
  get<T = unknown>(key: string): T;

  /**
   * Tear down all services and connections.
   */
  teardown(): Promise<void>;
}
```

---

### `Service<T>`

The core service interface. All Mantle services implement or partially implement this contract.

```typescript
interface Service<T, D = Partial<T>> {
  find(params?: ServiceParams): Promise<T[] | Paginated<T>>;
  get(id: Id, params?: ServiceParams): Promise<T>;
  create(data: D, params?: ServiceParams): Promise<T>;
  update(id: Id, data: D, params?: ServiceParams): Promise<T>;
  patch(id: Id, data: D, params?: ServiceParams): Promise<T>;
  remove(id: Id, params?: ServiceParams): Promise<T>;
}

type Id = string | number;

interface Paginated<T> {
  total: number;
  limit: number;
  skip: number;
  data: T[];
}
```

> Custom methods beyond these six are supported by implementing additional methods on the service class and registering them in `ServiceOptions.methods`.

---

### `ServiceOptions`

Options passed to `app.use()` when registering a service.

```typescript
interface ServiceOptions {
  /**
   * Which methods to expose via the transport.
   * Defaults to the six standard methods if not specified.
   * Include custom method names here to expose them.
   */
  methods?: string[];

  /**
   * Events this service will publish (for future real-time support).
   * Defaults to ['created', 'updated', 'patched', 'removed'].
   */
  events?: string[];
}
```

---

### `ServiceHandle<T>`

Returned by `app.service()`. Wraps the registered service and exposes the hook registration API.

```typescript
interface ServiceHandle<T> extends Service<T> {
  hooks(config: HookConfig<T>): this;
}
```

---

### `Repository<T>`

Base repository interface. Database adapters implement this. Services depend on this abstraction, never the concrete adapter.

```typescript
interface Repository<T, D = Partial<T>> {
  findAll(params?: QueryParams): Promise<T[]>;
  findById(id: Id): Promise<T | null>;
  save(data: D): Promise<T>;
  saveAll(data: D[]): Promise<T[]>;
  updateById(id: Id, data: D): Promise<T>;
  patchById(id: Id, data: D): Promise<T>;
  deleteById(id: Id): Promise<T>;
  count(params?: QueryParams): Promise<number>;
}

interface QueryParams {
  where?: Record<string, unknown>;
  limit?: number;
  skip?: number;
  sort?: Record<string, 'asc' | 'desc'>;
  select?: string[];
}
```

---

### `ServiceParams`

The params object passed to every service method. Carries context from the transport layer without the service knowing about HTTP.

```typescript
interface ServiceParams {
  /** Parsed query string parameters */
  query?: Record<string, unknown>;

  /** The authenticated user, if any. Set by auth hooks. */
  user?: Record<string, unknown>;

  /**
   * The transport provider that initiated this call.
   * 'rest' | 'websocket' | undefined (internal call).
   */
  provider?: string;

  /** Raw HTTP headers (set by transport adapter, read-only in service) */
  headers?: Record<string, string>;

  /** Arbitrary additional context set by hooks */
  [key: string]: unknown;
}
```

---

### `HookContext<T>`

The object passed through the hook pipeline. Hooks receive and return this object.

```typescript
interface HookContext<T = any> {
  /** The application instance */
  app: MantleApplication;

  /** The service this hook is running on */
  service: Service<T>;

  /** The service path (e.g. 'users') */
  path: string;

  /** The method being called (e.g. 'create') */
  method: string;

  /** The transport type or undefined for internal calls */
  provider?: string;

  /** Input parameters */
  params: ServiceParams;

  /** Input data (create, update, patch only) */
  data?: Partial<T>;

  /** The id (get, update, patch, remove only) */
  id?: Id;

  /** The result — set in after hooks, or used to short-circuit in before hooks */
  result?: T | T[] | Paginated<T>;

  /** The error (only in error hooks) */
  error?: Error;

  /** Whether this hook pipeline has been stopped early */
  statusCode?: number;
}
```

---

### `HookConfig<T>`

The hook registration map passed to `service.hooks()`.

```typescript
type HookFunction<T = any> = (context: HookContext<T>) => Promise<HookContext<T>> | HookContext<T>;

type MethodHookMap<T> = {
  [method in keyof Service<T> | 'all']?: HookFunction<T>[];
};

interface HookConfig<T = any> {
  before?: MethodHookMap<T>;
  after?: MethodHookMap<T>;
  error?: MethodHookMap<T>;
}
```

---

### `MantlePlugin`

The plugin contract. A plugin is a function that receives and configures the application.

```typescript
type MantlePlugin = (app: MantleApplication) => void | Promise<void>;
```

---

### Error Classes

All errors extend `MantleError`, which extends the native `Error`.

```typescript
class MantleError extends Error {
  readonly code: number;
  readonly className: string;
  readonly data?: unknown;
  readonly errors?: unknown[];
  toJSON(): Record<string, unknown>;
}

class BadRequest extends MantleError {}       // 400
class NotAuthenticated extends MantleError {} // 401
class Forbidden extends MantleError {}        // 403
class NotFound extends MantleError {}         // 404
class MethodNotAllowed extends MantleError {} // 405
class Conflict extends MantleError {}         // 409
class Unprocessable extends MantleError {}    // 422
class TooManyRequests extends MantleError {}  // 429
class GeneralError extends MantleError {}     // 500
class NotImplemented extends MantleError {}   // 501
class Unavailable extends MantleError {}      // 503
```

---

## Public API Surface — @mantlejs/express

### `express()`

Plugin factory. Configures the Mantle application to use Express as its HTTP transport.

```typescript
function express(expressApp?: ExpressApp): MantlePlugin;
```

### `rest()`

Configures REST routing for all registered services. Called inside `express()` automatically, but exposed for custom setups.

```typescript
function rest(): MantlePlugin;
```

### Usage Pattern

```typescript
import { mantle } from '@mantlejs/core';
import { express } from '@mantlejs/express';

const app = mantle().configure(express());

// Access the underlying Express app for custom middleware
app.use(cors());
app.use(express.json());

// Start listening
app.listen(3030);
```

### Method → Route Mapping

| Service Method | HTTP Method | Route |
|---|---|---|
| `find` | GET | `/path` |
| `get` | GET | `/path/:id` |
| `create` | POST | `/path` |
| `update` | PUT | `/path/:id` |
| `patch` | PATCH | `/path/:id` |
| `remove` | DELETE | `/path/:id` |
| custom | POST | `/path/methodName` |

---

## Public API Surface — @mantlejs/postgresql

### `postgresql()`

Plugin factory. Registers a PostgreSQL connection via Knex on the app.

```typescript
function postgresql(config: PostgreSQLConfig): MantlePlugin;

interface PostgreSQLConfig {
  /** Knex connection config or connection string */
  connection: Knex.StaticConnectionConfig | string;
  /** Connection pool options. Defaults: min 2, max 10. */
  pool?: { min?: number; max?: number };
}
```

### `KnexRepository<T>`

Base class for PostgreSQL-backed repositories. Implements `Repository<T>`.

```typescript
abstract class KnexRepository<T, D = Partial<T>> implements Repository<T, D> {
  constructor(app: MantleApplication);

  /** The table name. Must be set by the subclass. */
  abstract readonly tableName: string;

  /** The primary key field. Defaults to 'id'. */
  readonly idField: string = 'id';

  /** Whether to manage createdAt / updatedAt. Defaults to true. */
  readonly timestamps: boolean = true;

  // Implements all Repository<T, D> methods
  findAll(params?: QueryParams): Promise<T[]>;
  findById(id: Id): Promise<T | null>;
  save(data: D): Promise<T>;
  saveAll(data: D[]): Promise<T[]>;
  updateById(id: Id, data: D): Promise<T>;
  patchById(id: Id, data: D): Promise<T>;
  deleteById(id: Id): Promise<T>;
  count(params?: QueryParams): Promise<number>;

  /** Access the raw Knex query builder for this table */
  get db(): Knex.QueryBuilder;
}
```

### Usage Pattern

```typescript
import { KnexRepository } from '@mantlejs/postgresql';

class UserRepository extends KnexRepository<User> {
  readonly tableName = 'users';

  // Extend with custom queries
  async findByEmail(email: string): Promise<User | null> {
    return this.db.where({ email }).first() ?? null;
  }
}
```

---

## Public API Surface — @mantlejs/auth

### `auth()`

Plugin factory. Registers the authentication engine on the app.

```typescript
function auth(config: AuthConfig): MantlePlugin;

interface AuthConfig {
  /** JWT signing secret */
  secret: string;
  /** Access token expiry. Default: '1d' */
  accessTokenExpiresIn?: string;
  /** Refresh token expiry. Default: '7d' */
  refreshTokenExpiresIn?: string;
  /** The service path used to look up authenticated users. Default: 'users' */
  entity?: string;
  /** The field on the entity used as the unique identifier. Default: 'id' */
  entityId?: string;
}
```

### `authenticate()`

Hook factory. Protects service methods. Verifies the JWT and populates `params.user`.

```typescript
function authenticate(...strategies: string[]): HookFunction;

// Usage
app.service('messages').hooks({
  before: {
    all: [authenticate('jwt')],
  }
});
```

### `sanitizeUser()`

After hook. Strips sensitive fields (e.g. `password`) from service results before sending to the client.

```typescript
function sanitizeUser(fields?: string[]): HookFunction;
// Default stripped fields: ['password', 'passwordHash']
```

### Auth Routes (registered automatically by plugin)

| Method | Route | Description |
|---|---|---|
| POST | `/authentication` | Login — returns access + refresh tokens |
| DELETE | `/authentication` | Logout — invalidates refresh token |

---

## Public API Surface — @mantlejs/auth-local

### `localStrategy()`

Plugin factory. Registers the local (email + password) strategy with `@mantlejs/auth`.

```typescript
function localStrategy(config?: LocalStrategyConfig): MantlePlugin;

interface LocalStrategyConfig {
  /** Field used as the username/login. Default: 'email' */
  usernameField?: string;
  /** Field used as the password. Default: 'password' */
  passwordField?: string;
  /** Error message on failed authentication. Default: 'Invalid credentials' */
  errorMessage?: string;
}
```

### `hashPassword()`

Before hook. Hashes the specified field using bcrypt before a `create` or `patch`.

```typescript
function hashPassword(field?: string): HookFunction;
// Default field: 'password'
```

### Usage Pattern

```typescript
import { auth } from '@mantlejs/auth';
import { localStrategy, hashPassword } from '@mantlejs/auth-local';

app
  .configure(auth({ secret: process.env.JWT_SECRET! }))
  .configure(localStrategy());

app.service('users').hooks({
  before: {
    create: [hashPassword()],
  },
  after: {
    all: [sanitizeUser()],
  }
});
```

---

## Public API Surface — @mantlejs/upload

### `upload()`

Plugin factory. Configures file upload handling on the app.

```typescript
function upload(config?: UploadConfig): MantlePlugin;

interface UploadConfig {
  /** Max file size in bytes. Default: 10MB */
  maxFileSize?: number;
  /** Allowed MIME types. Default: all */
  allowedMimeTypes?: string[];
  /** Storage adapter. Default: local disk */
  storage?: StorageAdapter;
}
```

### `diskStorage()`

Built-in local disk storage adapter.

```typescript
function diskStorage(config: DiskStorageConfig): StorageAdapter;

interface DiskStorageConfig {
  /** Destination directory for uploaded files */
  destination: string;
  /** Optional filename transform. Default: timestamp + original name */
  filename?: (file: UploadedFile) => string;
}
```

### `handleUpload()`

Before hook. Processes the multipart upload and attaches file metadata to `context.data`.

```typescript
function handleUpload(field: string, options?: HandleUploadOptions): HookFunction;

interface HandleUploadOptions {
  /** Whether the field is required. Default: false */
  required?: boolean;
}
```

### `UploadedFile`

The shape of an uploaded file attached to `context.data` after `handleUpload()`.

```typescript
interface UploadedFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  /** Resolved path on disk (local storage) or URL (cloud storage) */
  path: string;
}
```

---

## Request Lifecycle (Data Flow)

The following traces a `POST /users` request end-to-end through a Mantle application configured with Express, PostgreSQL, and auth-local.

```
Client
  │
  │  POST /users  { email, password, name }
  ▼
@mantlejs/express  (Transport Layer)
  │  • Matches route to service: 'users' → create method
  │  • Parses body, maps req → ServiceParams
  │  • Sets params.provider = 'rest'
  │  • Sets params.headers
  ▼
Hook Pipeline — BEFORE  (Application Layer)
  │  • hashPassword('password')
  │       reads data.password → bcrypt.hash → writes data.password
  │  • validateSchema  (user-defined)
  │       validates data shape, throws BadRequest if invalid
  ▼
Service.create(data, params)  (Application + Domain Layer, co-located)
  │  • Calls UserRepository.save(data)
  ▼
UserRepository.save(data)  (Infrastructure Layer)
  │  extends KnexRepository<User>
  │  • Builds INSERT query via Knex
  │  • Executes against PostgreSQL connection pool
  │  • Returns inserted row as User entity
  ▼
Service.create (receives result)
  │  • Returns User entity to hook pipeline
  ▼
Hook Pipeline — AFTER  (Application Layer)
  │  • sanitizeUser()
  │       strips 'password' field from result
  ▼
@mantlejs/express  (Transport Layer)
  │  • Serializes result to JSON
  │  • Sets HTTP 201 Created
  ▼
Client
     HTTP 201  { id, email, name, createdAt, updatedAt }
```

### Error Path

If any hook or service method throws a `MantleError` (or any error), the hook pipeline short-circuits and routes to the error hook chain:

```
Error thrown anywhere in pipeline
  ▼
Hook Pipeline — ERROR
  │  • logError  (user-defined)
  ▼
@mantlejs/express error handler
  │  • Maps MantleError.code → HTTP status
  │  • Serializes via MantleError.toJSON()
  ▼
Client
     HTTP 4xx/5xx  { name, message, code, data? }
```

---

## Deferred to Full TDD

The following topics are intentionally out of scope for this thin TDD and will be addressed in the full TDD as Phase 1 implementation progresses:

- Internal implementation of the hook pipeline engine (composition, ordering, short-circuiting)
- Internal service registry implementation inside `MantleApplication`
- How `@mantlejs/express` maps Express `req`/`res` lifecycle to Mantle context
- Knex connection lifecycle management and pool teardown
- JWT storage strategy (header vs cookie) and refresh token rotation implementation
- Internal strategy runner in `@mantlejs/auth`
- `busboy` stream handling internals in `@mantlejs/upload`
- Nx project configuration, build targets, and test setup per package
- ESM/CJS dual output compilation setup per package
