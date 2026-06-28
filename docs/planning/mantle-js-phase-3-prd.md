# Product Requirements Document
# Mantle JS — Phase 3

**Version:** 0.3.0-draft
**Status:** Planning
**License:** MIT
**Last Updated:** 2026-06-28
**Companion:** [Mantle JS Phase 2 PRD](./mantle-js-phase-2-prd.md)

---

## Table of Contents

1. [Overview](#overview)
2. [Goals & Non-Goals](#goals--non-goals)
3. [Phase 3 Package Specifications](#phase-3-package-specifications)
4. [Package Structure Additions](#package-structure-additions)
5. [Developer Experience Principles](#developer-experience-principles)
6. [Success Metrics](#success-metrics)
7. [Architectural & Design Decisions](#architectural--design-decisions)

---

## Overview

Phase 2 made Mantle production-ready with real-time socket support, schema validation, logging, and cloud storage. Phase 3 makes Mantle **horizontally scalable** and adds official **client SDKs** and additional database adapters.

The central challenge Phase 3 solves: a Mantle application running on multiple instances (pods, containers) has one socket.io server per process. A REST mutation on instance A triggers `service:event` locally — instance A's socket clients receive the broadcast, but clients connected to instances B and C do not. `@mantlejs/sync` solves this by routing service events through a shared message broker so all instances broadcast to their local clients.

Phase 3 prerequisite: the `@mantlejs/socketio` channels API (added in Phase 2) must be in place. `@mantlejs/sync` replays events through the channels system on each instance, which means channel filtering (security, tenant scoping) is applied locally — not stripped by the broker.

Phase 3 package summary:

| Package | Purpose |
|---|---|
| `@mantlejs/sync` | Cross-instance service event replication via Redis (or AMQP) |
| `@mantlejs/client` | Official JS/TS client SDK with real-time subscriptions |
| `@mantlejs/mongodb` | MongoDB adapter implementing `Repository<T>` |
| `@mantlejs/koa` | Koa HTTP transport adapter |

---

## Goals & Non-Goals

### Goals

- Enable horizontal scaling: a mutation on any instance reaches socket clients on all instances
- Provide a first-party JS/TS client SDK with REST and real-time support
- Add MongoDB as a supported database via `@mantlejs/mongodb`
- Add Koa as a supported HTTP transport via `@mantlejs/koa`
- Preserve the channels security model across instances: channel filtering runs locally on each instance, not at the broker
- Support Redis as the primary sync adapter; leave the door open for AMQP/RabbitMQ

### Non-Goals (Phase 3)

- No GraphQL transport (Phase 4)
- No React/Vue/iOS/Android client SDKs (Phase 4 — Phase 3 ships the core JS client only)
- No Prisma adapter (Phase 4)
- No multi-tenancy primitives (Phase 4)
- No OpenAPI/Swagger auto-generation (Phase 4)
- No rate limiting plugin (Phase 4)
- No built-in AMQP adapter (community or Phase 4 — Redis covers the majority of deployments)
- No sticky session management — leave to load balancer configuration

---

## Phase 3 Package Specifications

---

### `@mantlejs/sync`

Cross-instance service event replication. Ensures that a service mutation on any instance triggers socket broadcasts on **all** instances, while preserving the channels security model.

**Dependencies:** `@mantlejs/mantle` (peer), adapter-specific packages (e.g. `ioredis` for `redisAdapter`)

**Requires:** `@mantlejs/socketio` with channels configured (Phase 2)

#### How it works

Without sync, service events flow entirely within the process that handled the mutation:

```
Instance A  REST POST /messages
              → Service.create()
              → app.emit('service:event', ...)
              → socketio broadcasts to clients on A only
              
Instance B  clients connected here receive nothing ✗
Instance C  clients connected here receive nothing ✗
```

With `@mantlejs/sync`, the `'service:event'` is intercepted and published to a shared broker. Every instance subscribes and re-emits the event locally, where the socketio plugin fans it out through the channels system:

```
Instance A  REST POST /messages
              → Service.create()
              → app.emit('service:event', ...)
              → socketio broadcasts to local clients on A ✓
              → sync publishes to Redis

Redis broker  ←────────────────────────────────
                                               ↓
Instance A  receives own event, ignores (origin check)
Instance B  receives event → re-emits locally → channels → broadcast ✓
Instance C  receives event → re-emits locally → channels → broadcast ✓
```

Each instance applies its own channel publishers before broadcasting — channel filtering (tenant scoping, permission checks) runs locally, not at the broker layer.

#### `sync()` plugin factory

```typescript
function sync(options: SyncOptions): MantlePlugin;

interface SyncOptions {
  /** Adapter for the message broker */
  adapter: SyncAdapter;
  /** Event name filter. Default: sync all service:event emissions */
  events?: string[];
}
```

#### `SyncAdapter` interface

Implement this to add support for any message broker. The adapter is responsible for publish/subscribe semantics and JSON serialisation.

```typescript
interface SyncAdapter {
  publish(channel: string, message: SyncMessage): Promise<void>;
  subscribe(channel: string, handler: (message: SyncMessage) => void): Promise<void>;
  close(): Promise<void>;
}

interface SyncMessage {
  originId: string;   // UUID identifying the originating instance
  path: string;       // service path, e.g. 'messages'
  event: string;      // e.g. 'created', 'updated'
  result: unknown;    // service result (serialized to JSON)
  params: Record<string, unknown>;  // ServiceParams (serialized)
}
```

#### `redisAdapter()` — built-in Redis adapter

```typescript
function redisAdapter(options: RedisAdapterOptions): SyncAdapter;

interface RedisAdapterOptions {
  /** Redis connection URL. Default: 'redis://localhost:6379' */
  url?: string;
  /** Redis host. Ignored when url is set. Default: 'localhost' */
  host?: string;
  /** Redis port. Ignored when url is set. Default: 6379 */
  port?: number;
  /** Auth password */
  password?: string;
  /** Pub/sub channel prefix. Default: 'mantle:sync' */
  prefix?: string;
}
```

Uses `ioredis` (peer dependency) for pub/sub. Requires two Redis connections — one for publish, one for subscribe (Redis pub/sub protocol requirement).

#### Deduplication

Each `sync()` plugin instance generates a UUID at startup (`instanceId`). Every published message includes this ID. When a message is received from the broker, the receiving instance checks `message.originId === instanceId`. If matched, the event was published by this very instance, which already broadcast to its local clients directly — so the re-received message is dropped.

This ensures local clients get immediate delivery (without waiting for the round-trip through Redis) and remote clients are notified via Redis.

#### Event lifecycle with sync

```
Instance A: REST POST /messages
  ↓
ServiceHandleImpl.runPipeline()
  → app.emit('service:event', 'messages', 'created', result, params)
  ↓                              ↓
socketio plugin                 sync plugin
broadcasts to                   publishes to Redis
Instance A clients ✓            (with originId = instanceId_A)
  
Redis → Instance A: originId matches → skip ✓ (already sent)
Redis → Instance B: originId !== B's id
  → app.emit('service:event', 'messages', 'created', result, params)
  → socketio plugin → channel publisher → broadcast to Instance B clients ✓
Redis → Instance C: same as B ✓
```

#### Typical setup

```typescript
import { sync, redisAdapter } from '@mantlejs/sync';

const app = mantle()
  .configure(express())
  .configure(socketio())  // channels required
  .configure(sync({
    adapter: redisAdapter({ url: process.env.REDIS_URL }),
  }));

// Channel publisher — applied locally on every instance before broadcasting
app.service('messages').publish((data, ctx) => {
  return app.channel('authenticated');
});

app.listen(3030);
```

#### Error handling

If the Redis adapter fails to publish (network error, connection drop):
- The local broadcast on the originating instance **succeeds** — local clients are not affected
- The sync plugin logs a warning via `app.get('logger')`
- Remote instances do not receive the event for this mutation
- No exception is thrown to the caller — sync failures are non-fatal by design

If the subscriber connection drops, `ioredis` reconnects automatically. Events missed during a reconnect window are not replayed (no guaranteed delivery).

---

### `@mantlejs/client`

Official JS/TS client SDK. Communicates with a Mantle application over REST (via fetch) and real-time (via socket.io-client). Designed for use in browsers, Node.js, and React Native.

> Detailed specification to be written once Phase 3 implementation begins. The section below outlines scope and API direction only.

**Dependencies:** `@mantlejs/mantle` (types only, optional peer), `socket.io-client`

#### Design goals

- Mirrors the server-side `Service<T>` interface — the same `find`, `get`, `create`, `update`, `patch`, `remove` API works on both client and server
- Handles authentication token management (storage, refresh, attachment to requests)
- Provides reactive subscriptions to service events: `client.service('messages').on('created', handler)`
- TypeScript-first — generic `ServiceClient<T>` with full type inference
- No framework coupling — works standalone; React/Vue adapters ship separately in Phase 4

#### Approximate API shape

```typescript
import { mantle } from '@mantlejs/client';

const client = mantle({ url: 'http://localhost:3030' });

// REST calls
const messages = await client.service<Message>('messages').find();
const message  = await client.service<Message>('messages').create({ text: 'Hello' });

// Real-time subscriptions (over socket.io)
client.service<Message>('messages').on('created', (msg) => {
  console.log('New message:', msg);
});

// Authentication
await client.authenticate({ strategy: 'local', email, password });
client.getAccessToken(); // → string | undefined
```

---

### `@mantlejs/mongodb`

MongoDB adapter implementing `Repository<T>`. Targets MongoDB 6.x and the official `mongodb` Node.js driver (no Mongoose).

> Detailed specification to be written once Phase 3 implementation begins.

**Dependencies:** `@mantlejs/mantle`, `mongodb`

#### Design goals

- Implement the full `Repository<T>` interface using MongoDB collections
- Support all `QueryParams` operators (`$gt`, `$lt`, `$in`, `$or`, etc.) mapped to MongoDB query operators
- `findById` and `deleteById` accept both `string` (ObjectId) and `number` IDs — convert automatically
- Transactions via `MongoRepository.withTransaction(fn)`
- Mirror the `KnexRepository` developer experience where possible

---

### `@mantlejs/koa`

Koa HTTP transport adapter. Registers service routes on a Koa app and sets `params.provider = 'koa'`.

> Detailed specification to be written once Phase 3 implementation begins.

**Dependencies:** `@mantlejs/mantle`, `koa`, `@koa/router`

---

## Package Structure Additions

```text
mantle/
├── packages/
│   ├── [all Phase 1 + Phase 2 packages]
│   ├── sync/        @mantlejs/sync     [NEW P3]
│   ├── client/      @mantlejs/client   [NEW P3]
│   ├── mongodb/     @mantlejs/mongodb  [NEW P3]
│   └── koa/         @mantlejs/koa      [NEW P3]
```

### Updated Package Dependency Rules (Phase 3 additions)

| Package | May depend on |
|---|---|
| `@mantlejs/sync` | `@mantlejs/mantle` |
| `@mantlejs/client` | `@mantlejs/mantle` (types only, optional peer) |
| `@mantlejs/mongodb` | `@mantlejs/mantle` |
| `@mantlejs/koa` | `@mantlejs/mantle` |

`@mantlejs/sync` must NOT depend on `@mantlejs/socketio`. It operates at the `'service:event'` bus level (core) and is transport-agnostic — a future SSE or Koa/WebSocket transport would benefit from sync without any changes to the sync package.

---

## Developer Experience Principles

Phase 3 upholds all Phase 1 and Phase 2 principles and adds:

**10. Scale Transparently** — Adding `@mantlejs/sync` to an existing application is a one-liner plugin call. No changes to services, hooks, repositories, or channel publishers are required. The same channels security model (opt-in, publisher-controlled) applies across instances without additional configuration.

**11. Consistent Client API** — The `@mantlejs/client` SDK exposes the same `Service<T>` method names and error shapes developers already know from the server. Context switching between server and client code is minimal.

---

## Success Metrics

| Metric | Phase 3 Target |
|---|---|
| Cross-instance event delivery | < 10ms additional latency vs local delivery (Redis RTT) |
| Sync failure isolation | Redis outage does not affect REST response times or local socket delivery |
| Client SDK bundle size | < 20KB gzipped (excluding socket.io-client) |
| Channel security model preserved | Sync events go through channel publishers on each instance — no bypass |

---

## Architectural & Design Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Where does channel filtering happen in multi-instance deployments? | **Locally on each receiving instance.** The broker carries raw event data; each instance runs its own channel publishers. This preserves per-connection filtering (e.g. stripping sensitive fields per user) without the broker needing to know about user permissions. |
| 2 | Guaranteed delivery for sync events? | **No.** `@mantlejs/sync` provides best-effort delivery via Redis pub/sub. Events missed during a Redis outage or reconnect window are not replayed. For guaranteed delivery, applications should use a persistent queue (Kafka, RabbitMQ) — a community adapter could implement `SyncAdapter` for this. |
| 3 | Does sync affect local clients on the originating instance? | **No.** Local clients receive the event immediately via the direct `service:event` path. The sync message is ignored when it arrives back at the originating instance (origin ID check). |
| 4 | Why `ioredis` over `redis` (node-redis)? | `ioredis` has better built-in reconnect handling and is the de-facto standard in the Node.js ecosystem for pub/sub use cases. Developers who already use `node-redis` can implement `SyncAdapter` themselves. |
| 5 | Does `@mantlejs/sync` depend on `@mantlejs/socketio`? | **No.** `sync` operates at the `'service:event'` bus level in `@mantlejs/mantle`. It works with any transport that subscribes to `'service:event'`. A future Koa/WebSocket transport would benefit from sync with no changes. |
| 6 | MongoDB driver choice? | **Official `mongodb` driver** — no Mongoose. Aligns with the repository pattern: no ODM/ORM magic, no schema enforcement at the driver level. Developers define their entity shapes via TypeBox and handle validation in hooks. |
