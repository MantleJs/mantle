# @mantlejs/socketio

Socket.IO transport adapter for [Mantle JS](https://github.com/mantlejs/mantle). Bridges Mantle services to Socket.IO clients, enabling real-time bidirectional communication over WebSockets with the same hook pipeline used by REST adapters.

---

## Installation

```bash
npm install @mantlejs/socketio socket.io
```

---

## Concepts

### Transport adapter

`socketio()` is a Mantle plugin that registers a Socket.IO server alongside your existing HTTP transport. Incoming socket events are mapped to service method calls (`find`, `get`, `create`, `update`, `patch`, `remove`) and routed through the full hook pipeline — the same `before`, `after`, and `error` hooks run regardless of whether the call arrives over HTTP or WebSocket.

### Real-time events

When a service method mutates data (`create`, `update`, `patch`, `remove`), the adapter automatically emits a corresponding event (`created`, `updated`, `patched`, `removed`) to subscribed clients. Clients can subscribe to a service path to receive live updates.

### Provider

Calls arriving via Socket.IO set `params.provider = "socket.io"` in `HookContext`. Hooks can inspect this to apply transport-specific behavior (e.g. skip authentication for internal calls).

### Channels

Channels are named sets of socket connections. They control which clients receive a real-time event when a service mutates data.

Broadcasting is **opt-in**: until you register a publisher on a service (or globally via `app.publish()`), no events are sent to any client. When a publisher is registered, the transport calls it after each mutating method (`create`, `update`, `patch`, `remove`) and broadcasts the result to every connection returned by the publisher.

Each socket gets a **connection object** — a plain `Record<string, unknown>` that persists for the lifetime of that socket. It is passed to channel publishers and available as `params.connection` inside hooks, making it a natural place to stash per-socket state (e.g. the authenticated user after login).

---

## Quick start

```typescript
import { mantle } from "@mantlejs/core";
import { express } from "@mantlejs/express";
import { socketio } from "@mantlejs/socketio";

const app = mantle().configure(express()).configure(socketio());

app.listen(3030);
```

**Client (browser or Node)**

```typescript
import { io } from "socket.io-client";

const socket = io("http://localhost:3030");

// Call a service method
socket.emit("find", "messages", {}, (error: unknown, result: unknown) => {
  console.log(result);
});

// Listen for real-time events
socket.on("messages created", (message: unknown) => {
  console.log("New message:", message);
});
```

---

## Channels quick start

```typescript
import { mantle } from "@mantlejs/core";
import { express } from "@mantlejs/express";
import { socketio } from "@mantlejs/socketio";

const app = mantle().configure(express()).configure(socketio());

// 1. On connection, join every socket to the "everyone" channel
app.on("connection", (connection) => {
  app.channel("everyone").join(connection);
});

// 2. Broadcast all service events to the "everyone" channel
app.publish(() => app.channel("everyone"));

app.listen(3030);
```

**User-scoped channels** — join each socket to a per-user channel and broadcast only to that user:

```typescript
app.on("connection", (connection) => {
  // Store the user on the connection object so publishers can read it
  const userId = (connection["user"] as { id: number } | undefined)?.id;
  if (userId) {
    app.channel(`user/${userId}`).join(connection);
  }
});

app.service("messages").publish((data, ctx) => {
  const userId = (ctx.params.user as { id: number } | undefined)?.id;
  return userId ? app.channel(`user/${userId}`) : null;
});
```

**Filtered channels** — send an event only to connections that pass a predicate:

```typescript
app.service("messages").publish((data) =>
  app.channel("everyone").filter(
    (_data, connection) => (connection["role"] as string) === "admin",
  ),
);
```

**Multiple channels** — return an array to broadcast to the union of all connections (each socket receives the event at most once):

```typescript
app.service("notifications").publish((data, ctx) => [
  app.channel("admins"),
  app.channel(`user/${(ctx.params.user as { id: number }).id}`),
]);
```

---

## API

### `socketio(options?)`

Returns a `MantlePlugin`. Call via `app.configure(socketio(options))`. Must be configured after `express()`.

```typescript
app.configure(
  socketio({
    path: "/socket.io",
    timeout: 30000,
    serverOptions: { cors: { origin: "http://localhost:5173", credentials: true } },
  }),
);
```

#### `SocketioOptions`

| Field           | Type                     | Default        | Description                                        |
| --------------- | ------------------------ | -------------- | -------------------------------------------------- |
| `path`          | `string`                 | `"/socket.io"` | URL path the Socket.IO server listens on           |
| `timeout`       | `number`                 | `30000`        | Ping timeout in ms before closing idle connections |
| `serverOptions` | `Partial<ServerOptions>` | —              | Additional Socket.IO `Server` constructor options  |

---

### `app.channel(name)`

Returns a `MantleChannel` for the given name. Accepts a single name or an array of names. Channels are created lazily — calling `app.channel("foo")` twice returns the same underlying channel.

```typescript
// Single channel
const ch = app.channel("admins");

// Combined channel — deduplicates connections automatically
const ch = app.channel(["admins", "moderators"]);
```

Requires `socketio()` to be configured. Throws `GeneralError` if called before the plugin is registered.

---

### `app.publish(publisher)`

Registers a **global publisher** — called for every service that does not have its own per-service publisher. Returns `app` for chaining.

```typescript
app.publish((data, ctx) => {
  // ctx: { app, path, params }
  return app.channel("everyone");
});
```

Return `null`, `undefined`, or `void` to suppress broadcasting for a specific event.

---

### `app.service(path).publish(publisher)`

Registers a **per-service publisher**. Takes precedence over the global publisher for that service. Returns the service handle for chaining.

```typescript
app.service("messages").publish((data, ctx) => {
  const userId = (ctx.params.user as { id: number } | undefined)?.id;
  return userId ? app.channel(`user/${userId}`) : null;
});
```

---

### `app.channel(name).join(connection)` / `.leave(connection)`

Adds or removes a connection from the channel. Both methods return `this` for chaining. Joining a connection that is already in the channel is a no-op.

```typescript
app.on("connection", (connection) => {
  app.channel("everyone").join(connection);
});

app.on("disconnect", (connection) => {
  // Connections are removed from all channels automatically on disconnect —
  // you only need leave() for manual mid-session departures.
  app.channel("vip").leave(connection);
});
```

---

### `app.channel(name).filter(fn)`

Returns a new `MantleChannel` that wraps the original but only delivers events to connections for which `fn(data, connection)` returns `true`. Does not mutate the original channel.

```typescript
app.service("alerts").publish(() =>
  app.channel("everyone").filter(
    (data, connection) => (connection["role"] as string) !== "guest",
  ),
);
```

Filters compose: calling `.filter()` on an already-filtered channel ANDs the predicates.

---

### `connection` / `disconnect` events

```typescript
app.on("connection", (connection: Record<string, unknown>) => {
  // Fired when a new socket connects. `connection` is the per-socket state object.
  // This is where you join the socket to its initial channels.
});

app.on("disconnect", (connection: Record<string, unknown>) => {
  // Fired when a socket disconnects.
  // The socket is already removed from all channels automatically.
});
```

The `connection` object is the same reference passed to publishers via the channel's `connections` array, to filter predicates as the second argument, and to hooks as `params.connection`.

---

## Types

```typescript
import type { SocketioOptions } from "@mantlejs/socketio";
import type { MantleChannel, ChannelPublisher, PublishContext } from "@mantlejs/core";
```

| Type                        | Description                                                                      |
| --------------------------- | -------------------------------------------------------------------------------- |
| `SocketioOptions`           | Options passed to `socketio()`                                                   |
| `MantleChannel`             | Named set of socket connections; supports `join`, `leave`, and `filter`          |
| `ChannelPublisher<T>`       | `(data, ctx: PublishContext) => MantleChannel \| MantleChannel[] \| null \| void` |
| `PublishContext`            | `{ app, path, params }` — context passed to every publisher call                |

---

## Development

```bash
npx nx build socketio   # compile
npx nx test socketio    # run tests
npx nx lint socketio    # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build socketio
```

First publish (scoped packages require `--access public`):

```bash
cd packages/socketio
npm publish --access public
```

Subsequent releases — bump `version` in `packages/socketio/package.json`, then:

```bash
cd packages/socketio
npm publish
```
