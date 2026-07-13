# Mantle JS — Technical Design Document
# Phase 4

**Version:** 0.4.0-draft
**Status:** Planning
**Companion:** [Mantle JS Phase 4 PRD](./mantle-js-phase-4-prd.md)
**Last Updated:** 2026-07-05

---

## Table of Contents

1. [Scope of This Document](#scope-of-this-document)
2. [Package Dependency Graph](#package-dependency-graph)
3. [Public API Surface — `@mantlejs/client`](#public-api-surface--mantlejsclient)
4. [Public API Surface — `@mantlejs/react`](#public-api-surface--mantlejsreact)
5. [Authentication Flow — Client Side](#authentication-flow--client-side)
6. [Real-Time Cache Invalidation Lifecycle](#real-time-cache-invalidation-lifecycle)
7. [Error Deserialization](#error-deserialization)
8. [`@mantlejs/mongodb` — Repository Implementation](#mantlejsmongodb--repository-implementation)
9. [`@mantlejs/openapi` — Spec Generation](#mantlejsopenapi--spec-generation)
10. [Batch Requests — Server Dispatch & Client Coalescing](#batch-requests--server-dispatch--client-coalescing)
11. [CORS — Per-Transport Option Shape](#cors--per-transport-option-shape)
12. [`StorageAdapter` Interface Diff](#storageadapter-interface-diff)
13. [Refresh-Token Service — `@mantlejs/auth` (B-1)](#refresh-token-service--mantlejsauth-b-1)
14. [`RepositoryService<T>` — Framework Query Bridge (B-2)](#repositoryservicet--framework-query-bridge-b-2)

---

## Scope of This Document

This TDD covers the public TypeScript API surface and key data flows for Phase 4: the client-side packages
(`@mantlejs/client`, `@mantlejs/react`) plus the server-side additions folded into this phase — `@mantlejs/mongodb`,
`@mantlejs/openapi`, batch dispatch, CORS, and the `@mantlejs/storage` `StorageAdapter` extension.

---

## Package Dependency Graph

### Full Graph (Phase 1 + Phase 2 + Phase 3 + Phase 4)

```text
@mantlejs/mantle                        (no external deps)
│
├── @mantlejs/express                 depends on: @mantlejs/mantle, express
├── @mantlejs/koa                     depends on: @mantlejs/mantle, koa, @koa/router
├── @mantlejs/http                    depends on: @mantlejs/mantle  (zero framework deps)
├── @mantlejs/knex                    depends on: @mantlejs/mantle, knex
├── @mantlejs/dynamodb                depends on: @mantlejs/mantle, @aws-sdk/lib-dynamodb
├── @mantlejs/supabase                depends on: @mantlejs/mantle, @supabase/supabase-js
├── @mantlejs/pinecone                depends on: @mantlejs/mantle, @pinecone-database/pinecone
├── @mantlejs/qdrant                  depends on: @mantlejs/mantle, @qdrant/js-client-rest
├── @mantlejs/neo4j                   depends on: @mantlejs/mantle, neo4j-driver
├── @mantlejs/auth                    depends on: @mantlejs/mantle, jsonwebtoken
│   ├── @mantlejs/auth-local          depends on: @mantlejs/mantle, @mantlejs/auth, @node-rs/argon2
│   ├── @mantlejs/auth-google         depends on: @mantlejs/mantle, @mantlejs/auth-oauth
│   ├── @mantlejs/auth-github         depends on: @mantlejs/mantle, @mantlejs/auth-oauth
│   └── @mantlejs/auth-facebook       depends on: @mantlejs/mantle, @mantlejs/auth-oauth
├── @mantlejs/storage                  depends on: @mantlejs/mantle, busboy
│   ├── @mantlejs/storage-s3           depends on: @mantlejs/storage, @aws-sdk/client-s3
│   └── @mantlejs/storage-gcs          depends on: @mantlejs/storage, @google-cloud/storage
├── @mantlejs/logger                  depends on: @mantlejs/mantle, pino
├── @mantlejs/schema                  depends on: @mantlejs/mantle, @sinclair/typebox
├── @mantlejs/memory                  depends on: @mantlejs/mantle
├── @mantlejs/config                  depends on: @mantlejs/mantle, @sinclair/typebox*
├── @mantlejs/socketio                depends on: @mantlejs/mantle, socket.io
└── @mantlejs/sync                    depends on: @mantlejs/mantle
                                      peer: ioredis (for redisAdapter)

@mantlejs/client                      depends on: (none)            [NEW P4]
                                      optional peer: @mantlejs/mantle (types only)
                                      optional peer: socket.io-client (real-time only)

@mantlejs/react                       depends on: @mantlejs/client, @tanstack/react-query  [NEW P4]

@mantlejs/mongodb                     depends on: @mantlejs/mantle, mongodb            [NEW P4]
@mantlejs/openapi                     depends on: @mantlejs/mantle, @mantlejs/schema*   [NEW P4]
                                      (* peer — degrades to generic schemas if absent)

@mantlejs/cli                         (no runtime deps — code generator only)
create-mantle                         depends on: @mantlejs/cli
```

---

## Public API Surface — `@mantlejs/client`

### Exports

```typescript
export function mantle(options: ClientOptions): MantleClient;
export type {
  ClientOptions,
  MantleClient,
  ServiceClient,
  ClientParams,
  TokenStorage,
  AuthCredentials,
  AuthResult,
  MantleClientError,
};
```

### Types

```typescript
interface ClientOptions {
  /** Base URL of the Mantle server. Required. */
  url: string;
  /** Token storage. Default: localStorage (browser) / MemoryStorage (Node.js, React Native) */
  storage?: TokenStorage;
  /** Socket.io connection options. Omit to disable real-time features. */
  socket?: Record<string, unknown>;
  /** Default headers appended to every REST request. */
  headers?: Record<string, string>;
}

interface TokenStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

type Id = string | number;

interface ClientParams {
  /** Query parameters serialized into the URL for find/get. */
  query?: Record<string, unknown>;
  /** Per-request header overrides. */
  headers?: Record<string, string>;
}

interface AuthCredentials {
  strategy: string;
  [key: string]: unknown;
}

interface AuthResult {
  accessToken: string;
  refreshToken?: string;
  user: unknown;
}

type ServiceEvent = 'created' | 'updated' | 'patched' | 'removed';

interface MantleClientError extends Error {
  /** HTTP status code. */
  code: number;
  /** Error class name: 'BadRequest' | 'NotAuthenticated' | 'Forbidden' | 'NotFound' | etc. */
  name: string;
  message: string;
  data?: unknown;
  errors?: unknown[];
}

interface Paginated<T> {
  total: number;
  limit: number;
  skip: number;
  data: T[];
}

interface MantleClient {
  service<T = unknown>(path: string): ServiceClient<T>;
  authenticate(credentials: AuthCredentials): Promise<AuthResult>;
  logout(): Promise<void>;
  getAccessToken(): string | undefined;
  on(event: 'authenticated' | 'logout', handler: () => void): this;
  off(event: 'authenticated' | 'logout', handler: () => void): this;
}

interface ServiceClient<T> {
  find(params?: ClientParams): Promise<T[] | Paginated<T>>;
  get(id: Id, params?: ClientParams): Promise<T>;
  create(data: Partial<T>, params?: ClientParams): Promise<T>;
  update(id: Id, data: Partial<T>, params?: ClientParams): Promise<T>;
  patch(id: Id, data: Partial<T>, params?: ClientParams): Promise<T>;
  remove(id: Id, params?: ClientParams): Promise<T>;
  on(event: ServiceEvent, handler: (data: T) => void): this;
  off(event: ServiceEvent, handler: (data: T) => void): this;
}
```

### REST Implementation

Each service method maps to a REST call:

| Method | HTTP | URL |
|---|---|---|
| `find(params)` | GET | `/:service?<query>` |
| `get(id, params)` | GET | `/:service/:id?<query>` |
| `create(data, params)` | POST | `/:service` |
| `update(id, data, params)` | PUT | `/:service/:id` |
| `patch(id, data, params)` | PATCH | `/:service/:id` |
| `remove(id, params)` | DELETE | `/:service/:id` |

`ClientParams.query` is serialized as URL query parameters using `URLSearchParams`. Nested objects and arrays follow the same convention as `@mantlejs/express`: `{ $limit: 10, name: 'alice' }` → `?$limit=10&name=alice`.

### Token Refresh Behaviour

```
REST request
  ├── Attach Authorization: Bearer <accessToken>
  └── Send request
        ├── 2xx → return parsed body
        └── 401 → attempt refresh
              → POST /authentication/refresh { refreshToken }
              ├── 2xx → store new tokens → retry original request once
              └── error → throw NotAuthenticated, emit 'logout', clear tokens
```

### Socket Integration

The underlying socket connection is created lazily on the first `ServiceClient.on()` call. All service clients share one socket instance (one TCP connection). Each service client translates socket events:

| Socket event | `ServiceClient.on()` event |
|---|---|
| `messages created` | `'created'` |
| `messages updated` | `'updated'` |
| `messages patched` | `'patched'` |
| `messages removed` | `'removed'` |

Multiple `.on()` calls for the same event on the same service share a single underlying socket listener — the client manages its own listener registry and multiplexes.

### Error behaviour

| Scenario | Behaviour |
|---|---|
| Non-2xx response | Parse body as JSON, throw `MantleClientError` |
| Network failure | Throw native `TypeError` (fetch) — not wrapped |
| 401 → refresh fails | Throw `MantleClientError` with code 401, emit `'logout'` |
| `socket` not configured, `.on()` called | Throw `MantleClientError` with code 500, name `'GeneralError'` |
| `url` not provided | Throw `TypeError` at construction time |

---

## Public API Surface — `@mantlejs/react`

### Exports

```typescript
export function MantleProvider(props: MantleProviderProps): JSX.Element;
export function useMantleClient(): MantleClient;
export function useFind<T>(
  service: string,
  params?: ClientParams,
  options?: UseQueryOptions<T[]> & MantleQueryOptions
): UseQueryResult<T[]>;
export function useGet<T>(
  service: string,
  id: Id,
  params?: ClientParams,
  options?: UseQueryOptions<T> & MantleQueryOptions
): UseQueryResult<T>;
export function useCreate<T>(
  service: string,
  options?: UseMutationOptions<T, MantleClientError, Partial<T>>
): UseMutationResult<T, MantleClientError, Partial<T>>;
export function useUpdate<T>(
  service: string,
  options?: UseMutationOptions<T, MantleClientError, { id: Id; data: Partial<T> }>
): UseMutationResult<T, MantleClientError, { id: Id; data: Partial<T> }>;
export function usePatch<T>(
  service: string,
  options?: UseMutationOptions<T, MantleClientError, { id: Id; data: Partial<T> }>
): UseMutationResult<T, MantleClientError, { id: Id; data: Partial<T> }>;
export function useRemove<T>(
  service: string,
  options?: UseMutationOptions<T, MantleClientError, Id>
): UseMutationResult<T, MantleClientError, Id>;
export type { MantleProviderProps, MantleQueryOptions };
```

### Types

```typescript
interface MantleProviderProps {
  client: MantleClient;
  /** Custom QueryClient. Creates a default QueryClient if omitted. */
  queryClient?: QueryClient;
  children: ReactNode;
}

interface MantleQueryOptions {
  /**
   * Enable automatic real-time cache invalidation via socket events.
   * Default: true when the client has a socket configured, false otherwise.
   */
  realtime?: boolean;
}
```

### Query Keys

Query keys are deterministic and follow the pattern `[service, method, ...identifiers]`:

| Hook | Query key |
|---|---|
| `useFind('messages')` | `['messages', 'find']` |
| `useFind('messages', { query: { text: 'hello' } })` | `['messages', 'find', { query: { text: 'hello' } }]` |
| `useGet('messages', '42')` | `['messages', 'get', '42']` |
| `useGet('messages', '42', params)` | `['messages', 'get', '42', params]` |

Invalidation always targets `{ queryKey: [service] }` (prefix match) so both `find` and `get` queries for a service are invalidated together.

### `MantleProvider` internals

```
MantleProvider
  ├── Creates or accepts QueryClient
  ├── Wraps children in QueryClientProvider
  └── Stores MantleClient in React context (MantleContext)
```

`useMantleClient()` reads from `MantleContext` and throws a descriptive error if used outside a `MantleProvider`.

### Real-time listener lifecycle

```
useFind / useGet mounts
  └── useEffect (runs once per service, per client)
        ├── if realtime === false: skip
        ├── if client.socket not configured: skip
        └── client.service(service).on('created', invalidate)
            client.service(service).on('updated', invalidate)
            client.service(service).on('patched', invalidate)
            client.service(service).on('removed', invalidate)
            → return cleanup: .off() for each listener

  invalidate = () => queryClient.invalidateQueries({ queryKey: [service] })
```

Reference counting: the effect fires per component but each unique `(client, service)` pair registers its listeners only once — the client's internal multiplexer handles the deduplication. Cleanup calls `.off()` which decrements the internal reference count; the underlying socket listener is removed only when the count reaches zero.

---

## Authentication Flow — Client Side

```
1. App calls client.authenticate({ strategy: 'local', email, password })
        │
        ▼
   POST /authentication
   body: { strategy: 'local', email, password }
        │
        ▼
   Server returns { accessToken, refreshToken, user }
        │
        ├── storage.setItem('mantle-access-token', accessToken)
        ├── storage.setItem('mantle-refresh-token', refreshToken)
        └── client emits 'authenticated'

2. Subsequent request
        │
        ▼
   Reads accessToken from storage
   Sets Authorization: Bearer <accessToken>
        │
        ▼
   Request succeeds → return response

3. Token expiry (401 received)
        │
        ▼
   POST /authentication/refresh
   body: { refreshToken }
        │
        ├── Success: update tokens, retry original request
        └── Failure: clear tokens, emit 'logout', throw NotAuthenticated

4. client.logout()
        │
        ├── POST /authentication/logout (if server endpoint exists — fire-and-forget)
        ├── storage.removeItem('mantle-access-token')
        ├── storage.removeItem('mantle-refresh-token')
        └── client emits 'logout'
```

---

## Real-Time Cache Invalidation Lifecycle

The following traces a `POST /messages` mutation through the full client + React stack.

**Setup:**
```
Client side:
  const client = mantle({ url: '...', socket: {} });

  function Messages() {
    const { data } = useFind<Message>('messages');   // mounts
    // → registers socket listener: client.service('messages').on('created', invalidate)
  }
```

**Mutation flow:**
```
REST client (another tab, another user, or a useCreate mutation)
  │  POST /messages  { text: 'Hello' }
  ▼
Server: create → emit 'service:event' → socketio → broadcast 'messages created' to all
  ▼
socket.io-client (in browser)
  receives: 'messages created', { id: '1', text: 'Hello', ... }
  ▼
ServiceClient<Message> event multiplexer
  → calls all registered 'created' handlers
  ▼
@mantlejs/react invalidation handler
  queryClient.invalidateQueries({ queryKey: ['messages'] })
  ▼
TanStack Query
  → marks all ['messages', 'find', ...] queries as stale
  → triggers background refetch for mounted queries
  ▼
GET /messages → server returns updated list
  ▼
React re-renders Messages component with latest data ✓
```

**Key invariants:**
1. The socket listener is registered on first component mount, not on client creation.
2. Invalidation is coarse (full service key) — safe and predictable, avoids stale list views.
3. If the socket disconnects and reconnects, `socket.io-client`'s auto-reconnect restores subscriptions.
4. Components with `realtime: false` are never invalidated by socket events.
5. `useCreate`, `useUpdate`, `usePatch`, `useRemove` do not invalidate the cache on their own — they rely on the socket event from the server to trigger invalidation. Teams that need immediate optimistic updates can pass `onMutate` / `onSuccess` callbacks to the mutation hooks.

---

## Error Deserialization

Server error responses follow Mantle's error JSON format:

```json
{
  "name": "NotFound",
  "message": "No record found for id '42'",
  "code": 404,
  "data": {},
  "errors": []
}
```

The client deserializes this into a `MantleClientError`:

```typescript
async function parseError(response: Response): Promise<MantleClientError> {
  const body = await response.json().catch(() => ({}));
  const err = new Error(body.message ?? response.statusText) as MantleClientError;
  err.name = body.name ?? httpStatusName(response.status);
  err.code = body.code ?? response.status;
  err.data = body.data;
  err.errors = body.errors;
  return err;
}
```

`name` → status mapping:

| HTTP Status | Error name |
|---|---|
| 400 | `BadRequest` |
| 401 | `NotAuthenticated` |
| 403 | `Forbidden` |
| 404 | `NotFound` |
| 409 | `Conflict` |
| 422 | `Unprocessable` |
| 500 | `GeneralError` |

If the response body is not valid JSON (e.g. an nginx gateway error), the client constructs a `MantleClientError` from the HTTP status code only, with `message: response.statusText`.

---

## `@mantlejs/mongodb` — Repository Implementation

### Connection lifecycle

```typescript
function mongodb(options: MongoConfig): (app: MantleApplication) => void;

interface MongoConfig {
  /** Atlas or self-hosted connection string. */
  uri: string;
  dbName: string;
  clientOptions?: MongoClientOptions; // passed through to the driver
}
```

`configure(mongodb(...))` opens one `MongoClient`, stored on the app via `app.set('mongoClient', client)` and
`app.set('mongoDb', client.db(dbName))` — the same "connection lives on `app`, repositories pull it in their
constructor" pattern already used by `@mantlejs/knex`'s `knex()` plugin.

### `QueryParams` → MongoDB filter translation

| `QueryParams` | MongoDB filter |
|---|---|
| `{ field: value }` | `{ field: value }` |
| `{ field: null }` | `{ field: null }` |
| `{ field: { $lt: v } }` etc. | `{ field: { $lt: v } }` — direct passthrough, operator names already match |
| `{ field: { $ne: value } }` | `{ field: { $ne: value } }`; `{ $ne: null }` → `{ field: { $ne: null } }` |
| `{ field: { $in: [...] } }` / `$nin` | direct passthrough |
| `{ $or: [...] }` / `{ $and: [...] }` | direct passthrough (nested where-clauses recursed the same way) |
| `{ field: { $like: ... } }` / `$ilike` / `$notlike` | **throws `BadRequest`** — not supported; use `collection.find({ field: { $regex, $options } })` via the raw `collection` escape hatch |

`sort`/`limit`/`skip`/`select` map to `.sort()`/`.limit()`/`.skip()`/`.project()` on the underlying `Collection.find()` cursor.

### ID boundary

```typescript
protected toObjectId(id: Id): ObjectId {
  if (!ObjectId.isValid(String(id))) throw new BadRequest(`Invalid id: ${id}`);
  return new ObjectId(String(id));
}

protected fromDocument(doc: WithId<T>): T {
  const { _id, ...rest } = doc;
  return { ...rest, id: _id.toHexString() } as unknown as T;
}
```

`findById`/`updateById`/`patchById`/`deleteById` all convert the incoming `Id` through `toObjectId()` and convert
results back through `fromDocument()` before returning — callers never see a raw `ObjectId`.

### Transactions

```typescript
async withTransaction<R>(fn: (txRepo: this) => Promise<R>): Promise<R> {
  const session = this.client.startSession();
  try {
    let result: R;
    await session.withTransaction(async () => {
      result = await fn(this.boundToSession(session));
    });
    return result!;
  } finally {
    await session.endSession();
  }
}
```

Requires the target MongoDB deployment to be a replica set (true for every Atlas cluster, including free-tier
M0 — Atlas always provisions a 3-node replica set). Standalone self-hosted MongoDB without a replica set will
throw the driver's native `MongoServerError` on `startSession().withTransaction()`; this is documented as a
deployment requirement, not something Mantle works around.

---

## `@mantlejs/openapi` — Spec Generation

### Generation pipeline

```
app.services (registered via app.use())
  │
  ├── for each service:
  │     ├── read ServiceHandle.methods (allowed CRUD + custom methods)
  │     ├── scan hooks.before[method] for a @mantlejs/schema validate(schema) call → requestBody schema
  │     ├── scan hooks.before.all for authenticate('jwt') → mark path as requiring bearerAuth
  │     └── build a paths entry: GET/POST/PUT/PATCH/DELETE /{service}(/{id})
  │
  ▼
Assemble OpenAPI 3.1 document
  { openapi: '3.1.0', info, servers, paths, components: { schemas, securitySchemes } }
  │
  ├── serve at options.specPath (default '/openapi.json')
  └── if options.docsPath set: serve a static Swagger UI HTML page pointing at specPath
```

### Schema detection

`@mantlejs/schema`'s `validate()` hook attaches its TypeBox schema to the hook function as `hook.schema` (a
non-enumerable property set by `validate()` itself, purely for introspection — it has no effect on validation
behavior). `@mantlejs/openapi` reads `hook.schema` off each registered `before` hook; TypeBox schemas need no
conversion since `TSchema` is already valid JSON Schema, and OpenAPI 3.1 adopted JSON Schema 2020-12 directly.

### Degradation without a schema

Services with no detected schema still get a `paths` entry — `requestBody`/response `content` falls back to
`{ type: 'object' }`. The generator never throws or skips a service for lacking a schema; full spec accuracy is
additive as schema coverage grows, not a prerequisite for using `@mantlejs/openapi` at all.

---

## Batch Requests — Server Dispatch & Client Coalescing

### Server dispatch (`app.batch`)

```
POST /batch  body: BatchCall[]
  │
  ├── length > maxBatchSize (default 25) → 400 BadRequest, no calls executed
  │
  ▼
Promise.allSettled(
  calls.map(call => app.service(call.service)[call.method](call.data ?? call.id, call.params))
)
  │
  ▼
map each settled result to BatchResult, preserving input order:
  fulfilled → { status: 'success', result: value }
  rejected  → { status: 'error', error: { name, message, code } }   (MantleError shape)
  │
  ▼
200 OK  body: BatchResult[]
```

Each `app.service(call.service)[call.method](...)` call goes through `app.service()`'s normal resolution — the
exact same `ServiceHandle` used by REST routing — so the full `before`/`after`/`error` hook pipeline runs
per-call, including `authenticate('jwt')`. `params` passed to each call inherits the outer HTTP request's
`params.headers`/`params.user` (set by the batch route's own auth middleware) merged with the call's own `params`.

### Client coalescing scheduler

```typescript
class BatchScheduler {
  private queue: { call: BatchCall; resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];
  private scheduled = false;

  enqueue(call: BatchCall): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.queue.push({ call, resolve, reject });
      if (!this.scheduled) {
        this.scheduled = true;
        queueMicrotask(() => this.flush());  // or setTimeout(windowMs) if configured
      }
    });
  }

  private async flush() {
    const batch = this.queue.splice(0, this.maxSize);
    this.scheduled = this.queue.length > 0;
    if (this.scheduled) queueMicrotask(() => this.flush());

    const results = await fetch(`${this.baseUrl}/batch`, {
      method: 'POST',
      body: JSON.stringify(batch.map((b) => b.call)),
    }).then((r) => r.json());

    batch.forEach((b, i) => {
      const r = results[i];
      r.status === 'success' ? b.resolve(r.result) : b.reject(toMantleClientError(r.error));
    });
  }
}
```

Every `ServiceClient` method, when `ClientOptions.batch` is enabled, routes through `scheduler.enqueue(...)`
instead of issuing its own `fetch` directly. `maxSize` caps a single flush at the server's `maxBatchSize`; a
queue longer than that splits into multiple `POST /batch` requests rather than erroring client-side.

---

## CORS — Per-Transport Option Shape

```typescript
interface CorsOptions {
  origin?: boolean | string | string[] | ((origin: string) => boolean);
  methods?: string[];
  credentials?: boolean;
  maxAge?: number;
}
```

| Transport | Implementation |
|---|---|
| `@mantlejs/express` | `cors: true \| CorsOptions` translated to the `cors` npm package's options shape and mounted as the first middleware |
| `@mantlejs/koa` | `cors: true \| CorsOptions` translated to `@koa/cors`'s options shape |
| `@mantlejs/http` | Hand-rolled: sets `Access-Control-Allow-Origin`/`-Methods`/`-Credentials` headers and short-circuits `OPTIONS` preflight requests with `204` before the router runs |

`cors: true` resolves to `{ origin: true, methods: ['GET','POST','PUT','PATCH','DELETE'], credentials: false }` —
reflects the request `Origin` header, all Mantle CRUD verbs, no credentials unless explicitly opted in.

---

## `StorageAdapter` Interface Diff

```diff
 export interface StorageAdapter {
   store(stream: Readable, info: UploadFileInfo): Promise<UploadedFile>;
+  retrieve(key: string): Promise<Readable>;
+  delete(key: string): Promise<void>;
+  getSignedUrl?(key: string, options?: { expiresIn?: number }): Promise<string>;
 }

 export interface UploadedFile {
   fieldname: string;
   originalname: string;
   mimetype: string;
   size: number;
   path: string;
+  key: string;
 }
```

| Backend | `retrieve()` | `delete()` | `getSignedUrl()` |
|---|---|---|---|
| Disk (`@mantlejs/storage`) | `createReadStream(join(destination, key))` | `unlink(join(destination, key))` | not implemented — omitted from the object entirely (no direct-download concept for local disk) |
| S3 (`@mantlejs/storage-s3`) | `GetObjectCommand` → `Body` as a `Readable` | `DeleteObjectCommand` | `getSignedUrl(client, new GetObjectCommand(...), { expiresIn })` from `@aws-sdk/s3-request-presigner` |
| GCS (`@mantlejs/storage-gcs`) | `bucket.file(key).createReadStream()` | `bucket.file(key).delete()` | `bucket.file(key).getSignedUrl({ action: 'read', expires })` |

`key` for disk storage is the filename relative to `destination` (what `path` already resolved to before this
change); for S3/GCS, `key` is the object key used when the file was stored — `path` continues to hold the
public-style URL for display, `key` is what callers pass back into `retrieve()`/`delete()`/`getSignedUrl()`.

---

## Refresh-Token Service — `@mantlejs/auth` (B-1)

Closes review finding A3: refresh tokens are currently minted by the OAuth callback with the same secret, same
expiry, no storage, no rotation, and no revocation. This section defines the server-side refresh contract the
Phase 4 client retries against.

### Config additions (`packages/auth/src/lib/types.ts`)

```typescript
export interface AuthConfig {
  secret: string;
  algorithms?: string[];
  expiresIn?: string | number;          // access-token TTL, default "1d" (unchanged)
  issuer?: string;
  audience?: string | string[];
  refreshExpiresIn?: string | number;   // NEW — refresh-token TTL, default "30d"
  refreshTokenStore?: RefreshTokenStore; // NEW — default: in-memory store
}

export interface RefreshTokenStore {
  /** Record an issued refresh token. `expiresAt` is the JWT `exp` in epoch seconds. */
  add(jti: string, sub: string, expiresAt: number): void | Promise<void>;
  /**
   * Atomically remove and return whether `jti` was present. A `false` return on a
   * token whose JWT still verifies means the token was already used — theft signal.
   * (Redis implementation: GETDEL — see checklist D-6.)
   */
  consume(jti: string): boolean | Promise<boolean>;
  /** Revoke every outstanding refresh token for a subject. */
  revokeAll(sub: string): void | Promise<void>;
}
```

All three methods are sync-or-async so the in-memory default stays allocation-free while a Redis-backed store
(D-6) can be injected without an interface change. The in-memory store (`packages/auth/src/lib/refresh-token-store.ts`,
exported as `memoryRefreshTokenStore()`) keeps `Map<jti, { sub, expiresAt }>` plus a per-sub index for `revokeAll`,
and prunes expired entries opportunistically on `add`.

### Token issuance — one helper, used everywhere

`AuthEngine` gains:

```typescript
export interface AuthEngine {
  // ...existing members unchanged...
  /**
   * Issue an access + refresh token pair for a subject. The refresh token carries
   * { sub, type: "refresh", jti } signed with `refreshExpiresIn`, and its jti is
   * recorded in the RefreshTokenStore before the pair is returned.
   */
  createTokenPair(sub: string, accessExtra?: Record<string, unknown>): Promise<TokenPair>;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
```

`createJwt(payload)` gains an optional `options?: { expiresIn?: string | number }` second parameter (backward
compatible) so `createTokenPair` can override the TTL for the refresh JWT.

**Both existing issuers migrate to the helper** so `jti` bookkeeping is uniform:

- `@mantlejs/auth-local` `authenticate()` returns `{ accessToken, refreshToken, user }` via `createTokenPair(sub)`.
- `@mantlejs/auth-oauth` callback (`create-oauth-plugin.ts:104-108`) replaces its two hand-rolled `createJwt`
  calls with `createTokenPair(sub)`. The unregistered `{ sub, type: "refresh" }` token it minted before is gone.

### The `refresh` strategy

Refresh is implemented as a built-in `AuthStrategy` named `"refresh"`, registered by the `auth()` plugin itself —
so it flows through the existing `authentication` service with zero new routing:

```
POST /authentication   { "strategy": "refresh", "refreshToken": "<jwt>" }
```

Flow:

1. `verifyJwt(refreshToken)` — signature/expiry failure → `NotAuthenticated("Invalid refresh token")`.
2. `payload.type !== "refresh"` (e.g. an access token was submitted) → `NotAuthenticated("Invalid refresh token")`.
3. Missing `jti` or `sub` → `NotAuthenticated("Invalid refresh token")`.
4. `store.consume(jti)`:
   - `true` → rotation: return `createTokenPair(sub)` — a fresh access + refresh pair; the old refresh token is
     now dead.
   - `false` → **reuse detected** (the token verified but was already consumed or revoked): call
     `store.revokeAll(sub)` — the whole token family dies — and throw
     `NotAuthenticated("Refresh token reuse detected")`.

The strategy's `AuthResult` is `{ accessToken, refreshToken }` — no `user` field, since refresh proves possession
of a token, not fresh credentials. Client code keeps its user from the original login (or re-fetches once C-3
lands `authenticate("jwt", { entity })`).

**Decision — no alias route.** The Phase 4 `@mantlejs/client` retry targets `POST /authentication` with
`{ strategy: "refresh", refreshToken }`; there is no separate `/authentication/refresh` endpoint. The client item
in the Phase 4 checklist should be read accordingly. Rationale: one endpoint, one dispatch mechanism, and the
strategy name is self-describing in the request body — an agent reading the wire format needs no extra route
knowledge.

### Failure-mode table

| Input | Outcome |
|---|---|
| Valid, unused refresh token | 201 — new `{ accessToken, refreshToken }`, old jti consumed |
| Same refresh token replayed | 401 `NotAuthenticated`, **all** tokens for that sub revoked |
| Expired refresh token | 401 (JWT verification fails; store untouched) |
| Access token passed as `refreshToken` | 401 (`type` mismatch) |
| Token signed with wrong secret | 401 |
| Missing `refreshToken` field | 401 |

### Spec plan (`packages/auth/src/lib/refresh.spec.ts` + store spec)

- happy-path rotation: login (in-memory strategy) → refresh → new pair works, old token 401s on second use
- reuse detection: refresh twice with the same token → second call 401 **and** the newly rotated token is also dead
- expiry: refresh token signed with `refreshExpiresIn: "0s"` → 401, `consume` never called
- type mismatch: submit an access token → 401
- `memoryRefreshTokenStore`: consume-once semantics, `revokeAll`, pruning of expired entries

---

## `RepositoryService<T>` — Framework Query Bridge (B-2)

Closes review §4 item 2 / exec finding 1: there is no framework-owned bridge from `ServiceParams.query` (raw
strings from HTTP, canonicalized by A-6's `parseQueryString`) to `QueryParams` — every app hand-rolls it. This
class defines Mantle's HTTP query semantics; `@mantlejs/openapi` (Phase 4 item 4) and `@mantlejs/client` (item 1)
generate from and target exactly what is specified here.

### Public API (`packages/mantle/src/lib/repository-service.ts`)

```typescript
export interface RepositoryServiceOptions {
  /**
   * Duck-typed JSON-Schema-ish object: { properties: { field: { type: "number" | ... } } }.
   * Used only for string→type coercion of query values. NOT a TypeBox import —
   * @mantlejs/mantle keeps zero dependencies; a TypeBox schema satisfies this shape.
   */
  schema?: { properties?: Record<string, { type?: string }> };
  /** Whitelist of queryable fields. When set, a where/sort/select key outside it → BadRequest. */
  fields?: string[];
  /** Pagination defaults. When set, find() applies `default` and caps $limit at `max`. */
  paginate?: { default: number; max: number };
}

export class RepositoryService<T, D = Partial<T>> implements Service<T, D> {
  constructor(repository: Repository<T, D>, options?: RepositoryServiceOptions);
  find(params?: ServiceParams): Promise<Paginated<T>>;   // ALWAYS Paginated — never bare T[]
  get(id: Id, params?: ServiceParams): Promise<T>;
  create(data: D | D[], params?: ServiceParams): Promise<T | T[]>;
  update(id: Id, data: D, params?: ServiceParams): Promise<T>;
  patch(id: Id, data: D, params?: ServiceParams): Promise<T>;
  remove(id: Id, params?: ServiceParams): Promise<T>;
}
```

### Locked decisions

1. **Reserved keys** (FeathersJS convention), read from *inside* `params.query`; everything else is `where`:

   | Key | Type after coercion | Meaning |
   |---|---|---|
   | `$limit` | number ≥ 0 | page size (capped at `paginate.max` when configured) |
   | `$skip` | number ≥ 0 | offset |
   | `$sort` | `Record<field, "asc" \| "desc">` — accepts `asc`/`desc`/`1`/`-1` | sort order |
   | `$select` | `string[]` (bare string accepted → singleton array) | projection |

   Malformed values (`$limit=abc`, `$sort[x]=up`) → `BadRequest` naming the key and expected form.

2. **`find()` always returns `Paginated<T>`** — `{ total, limit, skip, data }`. `total` comes from
   `repository.count({ where })` (same where, no limit/skip). `skip` defaults to 0. `limit` in the envelope is the
   effective applied limit; when no limit was applied (no `$limit`, no `paginate`) it equals `total`. Rationale:
   a stable envelope is the single most agent-legible response shape — `T[] | Paginated<T>` unions force every
   consumer to branch.

3. **Field whitelist** — when `options.fields` is set, every where key (recursing through `$or`/`$and`), sort key,
   and select entry must be in it, else
   `BadRequest("Field 'x' is not queryable. Allowed: a, b, c")`. Operator keys (`$gt`, …) inside a field's
   operator object are exempt (they are validated by the adapter per A-3).

4. **String coercion** — when `options.schema` is present, where values are coerced against
   `schema.properties[field].type`: `"number"`/`"integer"` → `Number(v)` (NaN → `BadRequest`), `"boolean"` →
   `"true"`/`"false"` → boolean, `"null"` string is NOT special-cased (use `$ne`-style operators for null
   semantics). Coercion applies to bare values, operator-object values, `$in`/`$nin` arrays, and recursively into
   `$or`/`$and` branches. `$limit`/`$skip` are coerced regardless of schema. **Without a schema, where values pass
   through as strings unchanged** — adapters compare strings; this is documented in the README as the reason to
   provide a schema (or use C-6's `querySyntax()` once it lands).

5. **`update`/`patch`/`remove` propagate the repository's `NotFound` untouched** — no wrapping, no re-mapping.
   `get()` maps a `null` from `findById` to `NotFound("No record found for id '<id>'")`.

`create(data)` dispatches arrays to `repository.saveAll`, single objects to `repository.save`.

### Data flow

```
GET /users?age[$gt]=21&$limit=10&$sort[name]=asc
  │  transport (express/koa/http) → parseQueryString (A-6)
  ▼
params.query = { age: { $gt: "21" }, $limit: "10", $sort: { name: "asc" } }
  │  RepositoryService.find()
  │    1. split reserved keys ($limit/$skip/$sort/$select) from where
  │    2. whitelist check (options.fields)
  │    3. coerce ($limit → 10; age.$gt → 21 when schema says number)
  ▼
repository.findAll({ where: { age: { $gt: 21 } }, limit: 10, sort: { name: "asc" } })
repository.count({ where: { age: { $gt: 21 } } })
  ▼
{ total, limit: 10, skip: 0, data: [...] }
```

### Spec plan

- `packages/mantle/src/lib/repository-service.spec.ts` — unit: reserved-key parsing, coercion matrix, whitelist
  errors, envelope shape, NotFound propagation (against a minimal in-file fake repository — mantle cannot
  dev-import `@mantlejs/memory` without an Nx boundary cycle).
- `packages/memory/src/lib/repository-service.spec.ts` — the six-method acceptance suite against the real
  `MemoryRepository` (memory already depends on mantle, so the import direction is legal).
- `packages/express/src/lib/express.spec.ts` — full HTTP round-trip:
  `?age[$gt]=21&$limit=10&$sort[name]=asc` against a `RepositoryService` returns a `Paginated` envelope with
  coerced, filtered, sorted results.
- README section in `packages/mantle` documenting reserved keys, the envelope, and the no-schema string caveat.
