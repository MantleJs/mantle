# @mantlejs/react

React hooks for [Mantle JS](https://github.com/mantlejs/mantle) services, built on [TanStack Query v5](https://tanstack.com/query/latest) over the [`@mantlejs/client`](../client/README.md) SDK.

---

## Installation

```bash
npm install @mantlejs/react @mantlejs/client @tanstack/react-query react
```

`react`, `@tanstack/react-query`, and `@mantlejs/client` are peer dependencies — the package ships no React runtime or query cache of its own.

---

## Concepts

### Bindings, not a client

`@mantlejs/react` does not talk to a Mantle server itself. It wraps a `MantleClient` instance (from `@mantlejs/client`) and exposes it to a React component tree: query hooks for `find`/`get`, mutation hooks for `create`/`update`/`patch`/`remove`, all dispatched through the client's REST transport (auth headers, 401 refresh-retry, and typed errors included).

### Provider at the root, hooks in the tree

`MantleProvider` owns the client instance and a TanStack `QueryClient` (it creates a default one when none is passed). Hooks anywhere below it resolve both from context — no prop drilling, no module-level singletons.

### Deterministic query keys

Query keys follow `[service, method, ...identifiers]`:

| Hook call                          | Query key                           |
| ---------------------------------- | ----------------------------------- |
| `useFind("messages")`              | `["messages", "find"]`              |
| `useFind("messages", params)`      | `["messages", "find", params]`      |
| `useGet("messages", "42")`         | `["messages", "get", "42"]`         |
| `useGet("messages", "42", params)` | `["messages", "get", "42", params]` |

Invalidation always targets the `[service]` prefix, so `find` and `get` caches for a service invalidate together.

### Real-time cache invalidation

When the client was created with the `socket` option, `useFind` and `useGet` subscribe to the service's `created` / `updated` / `patched` / `removed` events and call `queryClient.invalidateQueries({ queryKey: [service] })` when one arrives. Subscriptions are reference-counted per service — one listener set no matter how many hooks are mounted, removed when the last hook unmounts. Opt out per hook with `realtime: false`.

Event delivery is at-most-once (see the [`@mantlejs/sync` README](../sync/README.md)): events emitted while the socket is disconnected are gone. To bound staleness, `MantleProvider` listens for the client's `'reconnect'` event and invalidates **every** query on re-connect, forcing mounted queries to refetch.

### Mutations do not invalidate

`useCreate` / `useUpdate` / `usePatch` / `useRemove` rely on the server's socket event to trigger invalidation. Without a socket, or for optimistic updates, pass TanStack's `onSuccess` / `onMutate` callbacks.

---

## Quick start

```tsx
import { mantle } from "@mantlejs/client";
import { MantleProvider, useCreate, useFind } from "@mantlejs/react";

const client = mantle({ url: "http://localhost:3030", socket: {} });

export function App() {
  return (
    <MantleProvider client={client}>
      <Messages />
    </MantleProvider>
  );
}

interface Message {
  id: number;
  text: string;
}

function Messages() {
  const { data, isPending } = useFind<Message>("messages", { query: { $limit: 25, $sort: { id: "desc" } } });
  const create = useCreate<Message>("messages");

  if (isPending) return <p>Loading…</p>;
  const messages = Array.isArray(data) ? data : (data?.data ?? []);
  return (
    <>
      <ul>
        {messages.map((m) => (
          <li key={m.id}>{m.text}</li>
        ))}
      </ul>
      <button onClick={() => create.mutate({ text: "Hello" })}>Send</button>
    </>
  );
}
```

When another client creates a message, the server broadcasts `messages created` over Socket.IO, the hook invalidates `["messages"]`, and the list refetches — no wiring needed.

---

## API

### `MantleProvider`

Wraps children in a `QueryClientProvider` and stores the `MantleClient` in context.

| Prop          | Type           | Default             | Description                                            |
| ------------- | -------------- | ------------------- | ------------------------------------------------------ |
| `client`      | `MantleClient` | required            | The `@mantlejs/client` instance hooks dispatch through |
| `queryClient` | `QueryClient`  | `new QueryClient()` | Custom TanStack Query client                           |

### `useMantleClient(): MantleClient`

The client from the nearest `MantleProvider`. Throws a descriptive `Error` when used outside one. Use it for anything the hooks don't cover — `client.authenticate(...)`, `client.service("docs").similar(...)`, auth events.

### Query hooks

```typescript
useFind<T>(service, params?, options?); // GET /:service        → UseQueryResult<T[] | Paginated<T>, MantleClientError>
useGet<T>(service, id, params?, options?); // GET /:service/:id → UseQueryResult<T, MantleClientError>
```

`options` accepts every TanStack `useQuery` option except `queryKey`/`queryFn`, plus:

| Option     | Type      | Default                            | Description                                    |
| ---------- | --------- | ---------------------------------- | ---------------------------------------------- |
| `realtime` | `boolean` | `true` when a socket is configured | Socket-driven cache invalidation for this hook |

### Mutation hooks

```typescript
useCreate<T>(service, options?); // variables: Partial<T>              → POST /:service
useUpdate<T>(service, options?); // variables: { id: Id; data: Partial<T> } → PUT /:service/:id
usePatch<T>(service, options?); //  variables: { id: Id; data: Partial<T> } → PATCH /:service/:id
useRemove<T>(service, options?); // variables: Id                      → DELETE /:service/:id
```

`options` accepts every TanStack `useMutation` option except `mutationFn`. Errors are typed `MantleClientError`.

---

## Types

| Type                  | Description                                                       |
| --------------------- | ----------------------------------------------------------------- |
| `MantleProviderProps` | Props for `MantleProvider` (`client`, `queryClient?`, `children`) |
| `MantleQueryOptions`  | The `realtime?: boolean` extension accepted by `useFind`/`useGet` |

---

## Development

```bash
npx nx build react     # compile
npx nx test react      # run tests
npx nx lint react      # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build react
```

First publish (scoped packages require `--access public`):

```bash
cd packages/react
npm publish --access public
```

Subsequent releases — bump `version` in `packages/react/package.json`, then:

```bash
cd packages/react
npm publish
```

### Testing locally with Verdaccio

```bash
# Terminal 1 — start the local registry
npx nx run @mantle/source:local-registry

# Terminal 2 — publish to it
cd packages/react
npm publish --registry http://localhost:4873

# Install from it in another project
npm install @mantlejs/react --registry http://localhost:4873
```
