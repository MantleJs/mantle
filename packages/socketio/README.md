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

## Types

```typescript
import type { SocketioOptions } from "@mantlejs/socketio";
```

| Type              | Description                    |
| ----------------- | ------------------------------ |
| `SocketioOptions` | Options passed to `socketio()` |

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
