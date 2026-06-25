# Socket.IO Transport: Mantle vs FeathersJS

Comparison of `@mantlejs/socketio` against `@feathersjs/socketio`, covering wire protocol, real-time event broadcasting, connection state, custom methods, and selective broadcast.

---

## Summary table

| Feature | Mantle | FeathersJS |
|---|---|---|
| Hook pipeline integration | ✅ | ✅ |
| `params.provider` value | `"socket.io"` | `"socketio"` |
| Wire protocol | method-as-event + service path arg | `path::method` event name |
| REST → socket event broadcast | ✅ via app `'service:event'` bus | ✅ via channels |
| Selective broadcast | ✅ `params.rooms` (socket.io rooms) | ✅ full channels API |
| Per-connection state | ✅ `params.connection` | ✅ connection object |
| Custom methods over socket | ✅ via `service.dispatch()` | ✅ |
| Error serialization | `MantleError.toJSON()` | `FeathersError.toJSON()` |

---

## Wire protocol

### FeathersJS

Uses the service path as part of the event name — one event per service+method combination:

```js
socket.emit('messages::create', data, params, callback)
socket.emit('messages::find', params, callback)
socket.emit('messages::get', id, params, callback)
```

The `::` separator lets the client address a specific service without the server needing to parse a position argument.

### Mantle

Uses the method name as the socket event, with the service path as the first positional argument:

```js
socket.emit('create', 'messages', data, params, callback)
socket.emit('find', 'messages', params, callback)
socket.emit('get', 'messages', id, params, callback)
```

This is more idiomatic socket.io (event = verb, like HTTP method = verb), but means clients cannot selectively subscribe to events for a single service without filtering by the first argument.

---

## Real-time event broadcasting

### FeathersJS — channels

FeathersJS has a **channels** system that decouples event emission from the transport that triggered the mutation:

```js
app.on('connection', connection => {
  app.channel('anonymous').join(connection);
});

app.service('messages').publish((data, context) => {
  return app.channel('authenticated');
});
```

Key properties:
- A REST `POST /messages` **also** emits `messages created` to all subscribed socket clients.
- Channels let you broadcast selectively to named groups (authenticated users, admins, specific rooms).
- On socket disconnect, channel membership is cleaned up automatically.

### Mantle — app event bus + `params.rooms`

`@mantlejs/core` emits `'service:event'` on the application after every successful mutation, regardless of transport. `@mantlejs/socketio` subscribes once at startup:

```typescript
// Inside wireSocketEvents — one subscription handles all services and transports
app.on('service:event', (path, event, result, params) => {
  const rooms = params.rooms;
  if (rooms) {
    io.to(rooms).emit(`${path} ${event}`, result);
  } else {
    io.emit(`${path} ${event}`, result);
  }
});
```

A REST `POST /messages` now triggers `messages created` on socket clients automatically. Selective broadcast uses socket.io rooms via `params.rooms` set by a before hook:

```typescript
app.service('messages').hooks({
  before: {
    create: [
      (ctx) => {
        ctx.params.rooms = [`channel:${ctx.params.user?.org}`];
        return ctx;
      },
    ],
  },
});
```

**Remaining difference:** FeathersJS channels support dynamic per-connection membership (join/leave groups); Mantle uses socket.io rooms directly. For many use cases — tenant isolation, per-user subscriptions — rooms are sufficient. A higher-level channel abstraction could wrap them later.

---

## Per-connection state

### FeathersJS

Maintains a **connection object** per socket that persists across all events from that socket:

```js
context.params.connection.user = verifiedUser; // set once at auth
context.params.connection.user; // available on every subsequent call
```

### Mantle

Each socket connection gets a `connection` object (a `Record<string, unknown>`) that lives for the lifetime of the socket. It is available to hooks as `params.connection`:

```typescript
app.service('messages').hooks({
  before: {
    all: [
      async (ctx) => {
        if (!ctx.params.connection?.user) {
          ctx.params.connection = {
            ...ctx.params.connection,
            user: await verifyToken(ctx),
          };
        }
        ctx.params.user = ctx.params.connection.user as Record<string, unknown>;
        return ctx;
      },
    ],
  },
});
```

On disconnect, the connection map entry is cleaned up automatically inside `wireSocketEvents`.

---

## Custom methods

### FeathersJS

Supports custom service methods by name over socket.io, declared on the service:

```js
app.use('payments', paymentsService, { methods: ['find', 'charge'] });
socket.emit('payments::charge', data, params, callback);
```

### Mantle

Custom methods declared in `app.use()` options are routed through `ServiceHandle.dispatch()`:

```typescript
app.use('payments', paymentsService, { methods: ['find', 'charge'] });
// Client:
socket.emit('charge', 'payments', data, params, callback)
```

Methods not in the declared list are rejected with a `GeneralError`. `ServiceHandle.methods` (new in Phase 2) exposes the allowed list for routing decisions.

---

## What Mantle does better

- **Simpler mental model** — `params.rooms` maps directly to socket.io concepts developers already know; no separate channels API to learn.
- **Cross-transport events without configuration** — `'service:event'` fires automatically for every transport; no per-service `publish()` callback required.
- **Event naming** — Method names as socket events (`create`, `find`, ...) mirrors REST verbs and is more aligned with standard socket.io conventions.
- **Zero framework coupling** — The hook pipeline is identical for REST and socket calls.

---

## Remaining differences (intentional, not gaps)

| Dimension | Mantle approach | FeathersJS approach |
|---|---|---|
| Selective broadcast | socket.io rooms via `params.rooms` | named channels with join/leave membership |
| Connection persistence | `params.connection` (plain object, per socket) | `params.connection` (managed, per-socket) |
| Channel fan-out config | before hooks set `params.rooms` | per-service `publish()` callback |

The FeathersJS channel API is more expressive for applications that need dynamic group membership (users joining and leaving topic channels at runtime). The Mantle approach with `params.rooms` handles the common cases (tenant scoping, per-user delivery) with less API surface.
