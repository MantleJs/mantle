---
title: Realtime
description: Service events over Socket.IO with channels, cross-instance fan-out with @mantlejs/sync, and live queries on the client.
sidebar:
  order: 5
---

Every successful `create`, `update`, `patch`, and `remove` emits a service event — `created`, `updated`,
`patched`, `removed` (plus any custom events a service declares). Three packages carry those events to clients:

| Package                                                                         | Role                                                                            |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`@mantlejs/socketio`](/packages/socketio/)                                     | Socket.IO transport: service calls over the socket, events out through channels |
| [`@mantlejs/sync`](/packages/sync/)                                             | Relays events between app instances via Redis or Supabase Realtime              |
| [`@mantlejs/client`](/packages/client/) / [`@mantlejs/react`](/packages/react/) | Subscribe on the client; React hooks keep queries fresh                         |

## Socket.IO and channels

```typescript
import { mantle } from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { socketio } from "@mantlejs/socketio";

const app = mantle().configure(express()).configure(socketio());

// Who receives what: join each connection to channels, then publish events to channels.
app.on("connection", (connection) => {
  app.channel("everyone").join(connection);
});
app.publish(() => app.channel("everyone"));

app.listen(3030);
```

Nothing is broadcast until a publisher says where an event goes — mutations still happen, but no client hears
about them. Publishers can be global (`app.publish`) or per service (`app.service("messages").publish(…)`), and
channels can be per user or filtered by a predicate, which is how you keep one user's events away from another.

Calls made over the socket (`socket.emit("find", "messages", …)`) are ordinary service calls: they run the full
hook pipeline with `provider: "socket.io"`.

## More than one instance

Behind a load balancer, a client connected to instance A must still hear about a write handled by instance B.
[`@mantlejs/sync`](/packages/sync/) publishes every local service event to a shared channel and re-emits events
from other instances locally, where the Socket.IO transport fans them out:

```typescript
import { sync, redisAdapter } from "@mantlejs/sync";

app.configure(sync({ adapter: redisAdapter({ url: process.env.REDIS_URL }) }));
```

Delivery is **at-most-once** — there's no persistence or replay. Treat events as cache-invalidation hints, not as
a source of truth, and refetch after a reconnect.

## On the client

```typescript
import { mantle } from "@mantlejs/client";

const api = mantle({ url: "http://localhost:3030", socket: {} }); // socket.io-client is an optional peer
api.service("messages").on("created", (message) => console.log("new message", message));
api.on("reconnect", () => console.log("reconnected — refetch anything stale"));
```

In React, [`@mantlejs/react`](/packages/react/)'s `useFind` and `useGet` subscribe automatically when the client
has a socket, invalidate the affected queries on each event, and `MantleProvider` invalidates every query after a
reconnect — so missed events cost a refetch, not stale data. To update a list in place with no request at all,
opt `useFind` into patch mode, which writes each event straight into its cached result (a `Paginated<T>`'s `total`
included):

```typescript
const { data } = useFind<Comment>(
  "comments",
  { query: { articleId, $sort: { createdAt: 1 } } },
  { realtime: { mode: "patch", matches: (comment) => comment.articleId === articleId, insert: "end" } },
);
```

`matches` mirrors the query's filter and `insert` its sort, so a created record lands where a refetch would have
put it. The [`realtime-list`](/blocks/realtime-list/) UI block is built on exactly this.
