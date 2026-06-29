# Mantle JS — Technical Design Document
# Phase 4

**Version:** 0.4.0-draft
**Status:** Planning
**Companion:** [Mantle JS Phase 4 PRD](./mantle-js-phase-4-prd.md)
**Last Updated:** 2026-06-28

---

## Table of Contents

1. [Scope of This Document](#scope-of-this-document)
2. [Package Dependency Graph](#package-dependency-graph)
3. [Public API Surface — `@mantlejs/client`](#public-api-surface--mantlejsclient)
4. [Public API Surface — `@mantlejs/react`](#public-api-surface--mantlejsreact)
5. [Authentication Flow — Client Side](#authentication-flow--client-side)
6. [Real-Time Cache Invalidation Lifecycle](#real-time-cache-invalidation-lifecycle)
7. [Error Deserialization](#error-deserialization)

---

## Scope of This Document

This TDD covers the public TypeScript API surface and key data flows for Phase 4 packages: `@mantlejs/client` and `@mantlejs/react`. Phase 4 is entirely client-side — no server-side changes are required.

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
├── @mantlejs/upload                  depends on: @mantlejs/mantle, busboy
│   ├── @mantlejs/upload-s3           depends on: @mantlejs/upload, @aws-sdk/client-s3
│   └── @mantlejs/upload-gcs          depends on: @mantlejs/upload, @google-cloud/storage
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
