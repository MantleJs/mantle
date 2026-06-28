# Mantle JS — Technical Design Document
# Phase 3

**Version:** 0.3.0-draft
**Status:** Planning
**Companion:** [Mantle JS Phase 3 PRD](./mantle-js-phase-3-prd.md)
**Last Updated:** 2026-06-28

---

## Table of Contents

1. [Scope of This Document](#scope-of-this-document)
2. [Package Dependency Graph](#package-dependency-graph)
3. [Public API Surface — `@mantlejs/sync`](#public-api-surface--mantlejssync)
4. [Public API Surface — `@mantlejs/client`](#public-api-surface--mantlejsclient)
5. [Public API Surface — `@mantlejs/mongodb`](#public-api-surface--mantlejsmongodb)
6. [Public API Surface — `@mantlejs/koa`](#public-api-surface--mantlejskoa)
7. [Event Replication Lifecycle](#event-replication-lifecycle)

---

## Scope of This Document

This TDD covers the public TypeScript API surface and key data flows for Phase 3 packages. `@mantlejs/sync` is specified in full. The other Phase 3 packages (`@mantlejs/client`, `@mantlejs/mongodb`, `@mantlejs/koa`) are outlined at the API-shape level; full TDD sections will be added as implementation begins.

---

## Package Dependency Graph

### Full Graph (Phase 1 + Phase 2 + Phase 3)

```text
@mantlejs/core                        (no external deps)
│
├── @mantlejs/express                 depends on: @mantlejs/core, express
├── @mantlejs/koa                     depends on: @mantlejs/core, koa, @koa/router  [NEW P3]
├── @mantlejs/knex                    depends on: @mantlejs/core, knex
├── @mantlejs/mongodb                 depends on: @mantlejs/core, mongodb           [NEW P3]
├── @mantlejs/auth                    depends on: @mantlejs/core, jsonwebtoken
│   ├── @mantlejs/auth-local          depends on: @mantlejs/core, @mantlejs/auth, @node-rs/argon2
│   ├── @mantlejs/auth-google         depends on: @mantlejs/core, @mantlejs/auth
│   └── @mantlejs/auth-github         depends on: @mantlejs/core, @mantlejs/auth
├── @mantlejs/upload                  depends on: @mantlejs/core, busboy
│   ├── @mantlejs/upload-s3           depends on: @mantlejs/upload, @aws-sdk/client-s3
│   └── @mantlejs/upload-gcs          depends on: @mantlejs/upload, @google-cloud/storage
├── @mantlejs/logger                  depends on: @mantlejs/core, pino
├── @mantlejs/schema                  depends on: @mantlejs/core, @sinclair/typebox
├── @mantlejs/memory                  depends on: @mantlejs/core
├── @mantlejs/config                  depends on: @mantlejs/core, @sinclair/typebox*
├── @mantlejs/socketio                depends on: @mantlejs/core, socket.io
└── @mantlejs/sync                    depends on: @mantlejs/core              [NEW P3]
                                      peer: ioredis (for redisAdapter)

@mantlejs/client                      depends on: socket.io-client             [NEW P3]
                                      optional peer: @mantlejs/core (types)
@mantlejs/cli                         (no runtime deps — code generator only)
```

### Dependency Rule: `@mantlejs/sync` must NOT import from `@mantlejs/socketio`

`sync` operates at the `'service:event'` level defined by `@mantlejs/core`. It is transport-agnostic. The `socketio` transport and the `sync` package both independently subscribe to `'service:event'` — there is no coordination layer between them. This means a future `@mantlejs/koa`-based WebSocket transport would benefit from `@mantlejs/sync` with zero changes to either package.

---

## Public API Surface — `@mantlejs/sync`

### Exports

```typescript
export function sync(options: SyncOptions): MantlePlugin;
export function redisAdapter(options: RedisAdapterOptions): SyncAdapter;
export type { SyncOptions, SyncAdapter, SyncMessage, RedisAdapterOptions };
```

### Types

```typescript
interface SyncOptions {
  /** Message broker adapter */
  adapter: SyncAdapter;
  /** Service paths to sync. Default: all services */
  services?: string[];
}

interface SyncAdapter {
  publish(channel: string, message: SyncMessage): Promise<void>;
  subscribe(channel: string, handler: (message: SyncMessage) => void): Promise<void>;
  close(): Promise<void>;
}

interface SyncMessage {
  /** UUID identifying the originating process instance. Used for deduplication. */
  originId: string;
  path: string;
  event: string;
  result: unknown;
  params: Record<string, unknown>;
}
```

### `sync(options)` — plugin

```typescript
function sync(options: SyncOptions): MantlePlugin;
```

When configured, the plugin:

1. Generates a stable `instanceId = crypto.randomUUID()` at startup (once per process).
2. Calls `adapter.subscribe(prefix, handler)` — begins receiving events from all instances.
3. Subscribes to `app.on('service:event', ...)`:
   - Skips events already received from the broker (`params.__syncOriginId` is set).
   - Publishes all other events to the broker as a `SyncMessage`.
4. On receiving a `SyncMessage` from the broker:
   - If `message.originId === instanceId`: drops the message (originating instance already broadcast locally).
   - Otherwise: calls `app.emit('service:event', path, event, result, { ...params, __syncOriginId: originId })`.
5. Calls `adapter.close()` on `app.teardown()`.

The `__syncOriginId` marker on `params` serves two purposes:
- Prevents the sync plugin from re-publishing events it received from the broker (loop prevention).
- Allows hooks to detect that an event originated from another instance (e.g. for custom logging).

### `redisAdapter(options)` — Redis adapter

```typescript
function redisAdapter(options: RedisAdapterOptions): SyncAdapter;

interface RedisAdapterOptions {
  url?: string;       // Redis URL. Default: 'redis://localhost:6379'
  host?: string;      // Ignored when url is set. Default: 'localhost'
  port?: number;      // Ignored when url is set. Default: 6379
  password?: string;
  /** Pub/sub channel name. Default: 'mantle:sync' */
  prefix?: string;
}
```

Implementation details:
- Uses `ioredis` (peer dependency — not bundled). The adapter requires the caller to have `ioredis` installed.
- Creates two `ioredis` instances: one publisher, one subscriber. Redis pub/sub requires a dedicated connection for `SUBSCRIBE`.
- Serializes `SyncMessage` to JSON using `JSON.stringify` / `JSON.parse`.
- On publish error: logs a warning and resolves without rethrowing. Local broadcast is unaffected.
- Reconnection is handled by `ioredis`'s built-in retry logic.

### Error behaviour

| Scenario | Behaviour |
|---|---|
| Redis publish fails | Warning logged, local broadcast unaffected, no exception to caller |
| Redis subscriber disconnects | `ioredis` reconnects automatically. Events during reconnect window are lost (no replay). |
| `adapter` not provided | `sync()` throws `GeneralError` at configure time |
| `app.teardown()` called | `adapter.close()` is awaited — connections are closed cleanly |

### Typical setup

```typescript
import { sync, redisAdapter } from '@mantlejs/sync';

const app = mantle()
  .configure(express())
  .configure(socketio())
  .configure(sync({
    adapter: redisAdapter({ url: process.env.REDIS_URL }),
  }));
```

---

## Public API Surface — `@mantlejs/client`

> Outline only — full TDD section to be written during implementation.

### Exports (planned)

```typescript
export function mantle(options: ClientOptions): MantleClient;
export type { ClientOptions, ServiceClient, ClientAuthOptions };
```

### Key types (planned)

```typescript
interface ClientOptions {
  /** Base URL of the Mantle server */
  url: string;
  /** Socket.io connection options */
  socket?: Partial<ManagerOptions & SocketOptions>;
  /** Storage for auth tokens. Default: MemoryStorage */
  storage?: TokenStorage;
}

interface MantleClient {
  service<T = unknown>(path: string): ServiceClient<T>;
  authenticate(options: ClientAuthOptions): Promise<AuthResult>;
  logout(): Promise<void>;
  getAccessToken(): string | undefined;
}

interface ServiceClient<T> {
  find(params?: Record<string, unknown>): Promise<T[]>;
  get(id: Id, params?: Record<string, unknown>): Promise<T>;
  create(data: Partial<T>, params?: Record<string, unknown>): Promise<T>;
  update(id: Id, data: Partial<T>, params?: Record<string, unknown>): Promise<T>;
  patch(id: Id, data: Partial<T>, params?: Record<string, unknown>): Promise<T>;
  remove(id: Id, params?: Record<string, unknown>): Promise<T>;
  on(event: 'created' | 'updated' | 'patched' | 'removed', handler: (data: T) => void): this;
  off(event: 'created' | 'updated' | 'patched' | 'removed', handler: (data: T) => void): this;
}
```

### Transport selection

- Service method calls (`find`, `get`, `create`, ...) use **REST** by default (`fetch`).
- Real-time subscriptions (`on('created', ...)`) use **socket.io** automatically — the client connects lazily on first `on()` call.
- A `transport` option per call will allow forcing socket.io for method calls (Phase 3 stretch goal).

---

## Public API Surface — `@mantlejs/mongodb`

> Outline only — full TDD section to be written during implementation.

### Exports (planned)

```typescript
export class MongoRepository<T extends Record<string, unknown>> implements Repository<T>;
export interface MongoRepositoryOptions { ... }
```

### Key design points

- Extends the `Repository<T>` interface from `@mantlejs/core` — same API as `KnexRepository`.
- `_id` is mapped to `id` on the way out (and vice versa on the way in). The public entity type always has `id: string`, never `_id`.
- All `QueryParams` operators are mapped to MongoDB query operators (`$gt` → `$gt`, `$or` → `$or`, `$like` → `$regex`, etc.).
- `withTransaction(fn)` uses MongoDB sessions and multi-document ACID transactions (requires MongoDB 4.0+ with replica set).

---

## Public API Surface — `@mantlejs/koa`

> Outline only — full TDD section to be written during implementation.

### Exports (planned)

```typescript
export function koa(options?: KoaOptions): MantlePlugin;
export interface KoaOptions { ... }
```

### Key design points

- Mirrors `@mantlejs/express` API: `app.configure(koa())`, then `app.listen(port)`.
- Registers one Koa router per registered service — maps HTTP methods to service methods identically to `@mantlejs/express`.
- Sets `params.provider = 'koa'`.
- Returns the same error format (`MantleError.toJSON()`) with the same HTTP status codes.

---

## Event Replication Lifecycle

The following traces a `POST /messages` request on Instance A through the full sync pipeline to clients connected to Instance B.

**Setup (all instances at startup):**
```
Instance A, B, C each:
  configure(socketio())   → subscribe to app 'service:event' → broadcast locally
  configure(sync(...))    → subscribe to app 'service:event' → publish to Redis
                          → subscribe to Redis → re-emit on app
  
  app.service('messages').publish((data, ctx) => {
    return app.channel('authenticated');
  });
  
  app.on('connection', (connection) => {
    app.channel('anonymous').join(connection);
  });
```

**Request flow:**
```
Client X (connected to Instance A)
  │  POST /messages  { text: 'Hello' }
  │  (REST — no socket)
  ▼
Instance A: @mantlejs/express
  → UserService.create()
  → Repository.save() → DB
  ▼
Instance A: @mantlejs/core (ServiceHandleImpl)
  → app.emit('service:event', 'messages', 'created', result, params)
                    │
          ┌─────────┴──────────────┐
          ▼                        ▼
  @mantlejs/socketio          @mantlejs/sync
  checks params.rooms         no __syncOriginId on params
  or channels publisher       → publishes to Redis:
  → broadcasts to             {
    Instance A clients ✓        originId: 'inst-A-uuid',
                                path: 'messages',
                                event: 'created',
                                result: { id, text, ... },
                                params: { provider: 'rest', ... }
                              }

Redis pub/sub
  ├── Instance A subscriber receives message
  │     originId === instanceId → DROP ✓ (already sent locally)
  │
  ├── Instance B subscriber receives message
  │     originId !== instanceId
  │     → app.emit('service:event', 'messages', 'created', result,
  │                { ...params, __syncOriginId: 'inst-A-uuid' })
  │     ▼
  │   @mantlejs/socketio (Instance B)
  │     → service.getPublisher() → app.service('messages').publish(...)
  │     → app.channel('authenticated').connections
  │     → broadcasts to authenticated clients on Instance B ✓
  │   @mantlejs/sync (Instance B)
  │     → sees __syncOriginId on params → SKIP publish ✓ (loop prevention)
  │
  └── Instance C: same as Instance B ✓
```

**Key invariants:**
1. Local clients on the originating instance receive the event synchronously (no Redis round-trip).
2. Remote clients receive the event after one Redis pub/sub round-trip (~1–2ms on co-located Redis).
3. Channel publishers run on each instance independently — access control is enforced locally, not at the broker.
4. `__syncOriginId` prevents both re-publishing loops and double-delivery to the originating instance.
5. If Redis is unavailable: local broadcast succeeds; remote instances receive nothing for that mutation.
