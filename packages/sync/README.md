# @mantlejs/sync

Cross-instance event synchronisation for [Mantle JS](https://github.com/mantlejs/mantle). Intercepts `service:event` emissions, publishes them to a shared message broker, and re-emits received messages from other instances — enabling `@mantlejs/socketio` to fan out real-time events across every connected process.

---

## Installation

```bash
npm install @mantlejs/sync
```

For Redis (ioredis is an optional peer dependency):

```bash
npm install @mantlejs/sync ioredis
```

---

## Concepts

### How it works

`sync()` listens for Mantle's internal `service:event` bus event (emitted after every `create`, `update`, `patch`, or `remove`) and publishes a `SyncMessage` to a shared pub/sub channel. Every other instance subscribed to that channel re-emits the message onto its own local event bus — where `@mantlejs/socketio` picks it up and fans it out to connected WebSocket clients.

Each instance generates a random `instanceId` (UUID) at startup. Messages received from the broker that carry the local `instanceId` as `originId` are dropped, preventing double-delivery to the originating process's clients.

Broker failures (publish errors, subscribe failures) are non-fatal: they are logged via `app.get('logger')` if a logger is configured, and execution continues.

### Adapters

| Adapter | Source | Transport |
| ------- | ------ | --------- |
| `redisAdapter()` | `@mantlejs/sync` | Redis pub/sub (ioredis, two connections) — also compatible with DragonflyDB |
| `supabaseAdapter()` | `@mantlejs/supabase` | Supabase Realtime Broadcast — zero additional infrastructure for Supabase users |

Custom adapters can be plugged in by implementing the `SyncAdapter` interface.

---

## Quick Start

### Redis

```typescript
import { mantle } from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { socketio } from "@mantlejs/socketio";
import { sync, redisAdapter } from "@mantlejs/sync";

const app = mantle()
  .configure(express())
  .configure(socketio())
  .configure(sync({ adapter: redisAdapter({ url: process.env.REDIS_URL }) }));

app.listen(3030);
```

### Supabase Realtime

```typescript
import { sync } from "@mantlejs/sync";
import { supabase, supabaseAdapter } from "@mantlejs/supabase";

app
  .configure(supabase())
  .configure(sync({ adapter: supabaseAdapter() }));
```

---

## API

### `sync(options)`

Returns a Mantle plugin that wires the sync adapter to the application event bus.

```typescript
function sync(options: SyncOptions): MantlePlugin;
```

#### Options

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `adapter` | `SyncAdapter` | — | **Required.** The pub/sub transport adapter. |
| `channel` | `string` | `"mantle:sync"` | Shared pub/sub channel name. Must be the same across all instances. |

---

### `redisAdapter(options?)`

Creates a Redis pub/sub adapter using ioredis with two dedicated connections (one for publishing, one for subscribing — required by the Redis protocol).

```typescript
function redisAdapter(options?: RedisAdapterOptions): SyncAdapter;
```

#### Options

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `url` | `string` | — | Full Redis URL (e.g. `"redis://user:pass@host:6379/0"`). Takes precedence over host/port. |
| `host` | `string` | `"127.0.0.1"` | Redis hostname. Ignored when `url` is set. |
| `port` | `number` | `6379` | Redis port. Ignored when `url` is set. |
| `password` | `string` | — | AUTH password. |
| `db` | `number` | `0` | Redis database index. |
| `tls` | `boolean` | `false` | Enable TLS. |

---

## Types

```typescript
import type { SyncMessage, SyncAdapter, SyncOptions, RedisAdapterOptions } from "@mantlejs/sync";
import { sync, redisAdapter } from "@mantlejs/sync";
```

### `SyncMessage`

The message envelope published and received by adapters.

```typescript
interface SyncMessage {
  originId: string;       // UUID of the originating instance
  path: string;           // service path (e.g. "users")
  event: string;          // event name (e.g. "created")
  result: unknown;        // the service method result
  params: Record<string, unknown>;
}
```

### `SyncAdapter`

Implement this interface to create a custom pub/sub adapter.

```typescript
interface SyncAdapter {
  publish(channel: string, message: SyncMessage): Promise<void>;
  subscribe(channel: string, handler: (message: SyncMessage) => void): Promise<void>;
  close(): Promise<void>;
}
```

---

## Development

```bash
npx nx build sync    # compile
npx nx test sync     # run tests
npx nx lint sync     # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build sync
```

First publish (scoped packages require `--access public`):

```bash
cd packages/sync
npm publish --access public
```

Subsequent releases — bump `version` in `packages/sync/package.json`, then:

```bash
cd packages/sync
npm publish
```
