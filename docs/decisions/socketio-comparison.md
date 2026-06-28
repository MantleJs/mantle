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
| Channels (opt-in security) | ✅ `app.channel()`, `service.publish()`, `channel.filter()` | ✅ full channels API |
| Per-connection state | ✅ `params.connection` | ✅ connection object |
| Custom methods over socket | ✅ via `service.dispatch()` | ✅ |
| Cross-instance replication | `@mantlejs/sync` (Phase 3) | `@feathersjs/sync` |
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

This mirrors the REST mental model — method is the action, path is the resource — which makes the protocol feel familiar to developers coming from HTTP:

| Transport | Action | Resource |
|---|---|---|
| REST | `POST` | `/messages` |
| Socket (Mantle) | `'create'` | `'messages'` (first arg) |
| Socket (Feathers) | `'messages::create'` | — (fused together) |

The tradeoff is client-side subscription ergonomics. In socket.io, clients subscribe by event name: `socket.on('eventName', handler)`. With FeathersJS's `path::method` protocol, the service is part of the name so subscriptions are precise:

```js
// FeathersJS — declarative, no filtering logic needed
socket.on('messages::create', handler);  // only fires for messages
socket.on('users::create', handler);     // only fires for users
```

With Mantle, `create` fires for every service, so the client must inspect the first argument:

```js
// Mantle — handler receives creates from all services
socket.on('create', (servicePath, data, params, callback) => {
  if (servicePath !== 'messages') return;  // manual filter required
  // handle messages create
});
```

As the number of services grows, clients either need one large handler with branching logic or must build their own routing layer on top. The Mantle approach optimises for server simplicity and REST familiarity; FeathersJS's naming is more ergonomic for clients that subscribe selectively to specific services.

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
- Channels let you broadcast selectively to named groups (authenticated users, admins, org-scoped rooms).
- On socket disconnect, channel membership is cleaned up automatically.
- Default-deny: if no publisher is declared, events are silently suppressed.

### Mantle — channels + app event bus

`@mantlejs/mantle` emits `'service:event'` on the application after every successful mutation, regardless of transport. `@mantlejs/socketio` implements a channels system on top of this bus.

**Usage is identical in shape to FeathersJS:**

```typescript
// Join connections to channels at connect time
app.on('connection', (connection) => {
  app.channel('anonymous').join(connection);
});

// Per-service publisher
app.service('messages').publish((data, ctx) => {
  return app.channel('authenticated');
});

// Global fallback publisher
app.publish((data, ctx) => {
  return app.channel('anonymous');
});
```

**Default-deny:** If no publisher is declared for a service (and no global publisher), the service event is silently dropped — clients receive nothing. This matches FeathersJS's security posture.

**Filtered channels:** Strip fields or limit delivery per-connection:

```typescript
app.service('users').publish((data, ctx) => {
  return app.channel('authenticated').filter((d, connection) => {
    return (connection.user as User)?.id === (d as User).id;
  });
});
```

**Combined channels:** Return multiple channels or use the array form:

```typescript
app.service('messages').publish((data, ctx) => {
  return [app.channel('admins'), app.channel(`org:${(data as Message).orgId}`)];
  // or: return app.channel(['admins', `org:${orgId}`]);
});
```

**How broadcasting works internally:**

```typescript
// Inside wireSocketEvents — subscribes once, handles all services and transports
app.on('service:event', (path, event, result, params) => {
  const publisher = service.publisher ?? app.get('__globalPublisher');
  if (!publisher) return;  // opt-in: no publisher = no broadcast

  const channels = toArray(publisher(result, { app, path, params }));
  // For each connection in channels: apply filter, deduplicate, socket.emit()
  broadcastToChannels(io, channels, `${path} ${event}`, result);
});
```

**Key difference from FeathersJS:** FeathersJS channels can also participate in multi-instance setups via `@feathersjs/sync` — events are published to a message broker and re-filtered on each instance. Mantle's equivalent is `@mantlejs/sync` (Phase 3), which operates at the same `'service:event'` bus level and preserves per-instance channel filtering.

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

- **Cross-transport events without configuration** — `'service:event'` fires automatically for every transport; the channels system picks it up. A REST mutation automatically reaches socket clients with no extra wiring.
- **Event naming** — Method names as socket events (`create`, `find`, ...) mirrors REST verbs and is more aligned with standard socket.io conventions.
- **Zero framework coupling** — The hook pipeline is identical for REST and socket calls.
- **Transport-agnostic sync** — `@mantlejs/sync` (Phase 3) operates at the `'service:event'` bus level, not the socket.io layer — a future Koa/WebSocket transport benefits automatically.

---

## Remaining differences (intentional, not gaps)

| Dimension | Mantle approach | FeathersJS approach |
|---|---|---|
| Wire protocol | `'create', 'messages', data, params, cb` | `'messages::create', data, params, cb` |
| Connection persistence | `params.connection` (plain object, per socket) | `params.connection` (managed, per-socket) |
| Cross-instance replication | `@mantlejs/sync` (Phase 3) | `@feathersjs/sync` (available now) |

The Mantle channels API (`app.channel()`, `service.publish()`, `channel.filter()`) is now feature-complete. The primary remaining gap is `@mantlejs/sync` — available in Phase 3 — for multi-instance deployments.
