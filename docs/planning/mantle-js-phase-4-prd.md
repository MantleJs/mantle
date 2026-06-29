# Product Requirements Document
# Mantle JS — Phase 4

**Version:** 0.4.0-draft
**Status:** Planning
**License:** MIT
**Last Updated:** 2026-06-28
**Companion:** [Mantle JS Phase 3 PRD](./mantle-js-phase-3-prd.md)

---

## Table of Contents

1. [Overview](#overview)
2. [Goals & Non-Goals](#goals--non-goals)
3. [Phase 4 Package Specifications](#phase-4-package-specifications)
4. [Package Structure Additions](#package-structure-additions)
5. [Developer Experience Principles](#developer-experience-principles)
6. [Success Metrics](#success-metrics)
7. [Architectural & Design Decisions](#architectural--design-decisions)

---

## Overview

Phase 3 completed the server-side ecosystem: transports (Koa, plain HTTP), OAuth strategies, NoSQL/vector/graph database adapters, real-time scaling with `@mantlejs/sync`, and CLI tooling. Phase 4 closes the loop with the client-side story.

Phase 4 delivers two packages and the first public npm release:

1. **`@mantlejs/client`** — official browser/Node.js/React Native SDK with REST (`fetch`) and real-time (`socket.io-client`) transport
2. **`@mantlejs/react`** — React hooks for Mantle services, built on TanStack Query v5 with automatic real-time cache invalidation
3. **First npm release** — all Mantle packages (Phase 1–4) published to the public npm registry at `0.1.0`

Phase 4 package summary:

| Package | Purpose |
|---|---|
| `@mantlejs/client` | Browser + Node.js client SDK — REST + Socket.io |
| `@mantlejs/react` | React hooks for Mantle services (TanStack Query v5) |

---

## Goals & Non-Goals

### Goals

- Ship `@mantlejs/client` — a first-party client SDK usable in browser, Node.js (18+), and React Native
- Implement REST-first transport with `fetch`, real-time subscriptions via `socket.io-client` (optional peer dep)
- Implement automatic token storage, refresh, and `Authorization` header injection
- Deserialize server error responses into typed `MantleClientError` objects
- Ship `@mantlejs/react` with TanStack Query v5 integration: `useFind`, `useGet`, `useCreate`, `useUpdate`, `usePatch`, `useRemove`
- Implement automatic real-time cache invalidation: service socket events call `queryClient.invalidateQueries`
- First public npm release of all packages at version `0.1.0`

### Non-Goals (Phase 4)

- No GraphQL transport (Phase 5)
- No OpenAPI/Swagger auto-generation (Phase 5)
- No rate limiting plugin (Phase 5)
- No multi-tenancy primitives (Phase 5)
- No Vue 3 composables or Svelte/SolidJS hooks (Phase 5 or community)
- No AWS Neptune, Azure Cosmos DB, or ArangoDB adapters (Phase 5 — multi-cloud)
- No Prisma or Mongoose adapters (community)
- No `@mantlejs/angular` or `@mantlejs/solid` (community or Phase 5)

---

## Phase 4 Package Specifications

---

### `@mantlejs/client`

Official JS/TS client SDK. Communicates with a Mantle application over REST (`fetch`) and real-time (`socket.io-client`). Designed for browsers, Node.js (18+), and React Native.

**Dependencies:** `socket.io-client` (optional peer — only required for real-time features)

```typescript
function mantle(options: ClientOptions): MantleClient;

interface ClientOptions {
  /** Base URL of the Mantle server. Required. */
  url: string;
  /** Storage for access/refresh tokens. Default: localStorage (browser) / in-memory (Node.js) */
  storage?: TokenStorage;
  /** Socket.io options. Omit to disable real-time. */
  socket?: SocketClientOptions;
  /** Default headers added to every REST request. */
  headers?: Record<string, string>;
}

interface TokenStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}
```

#### Service client API

```typescript
interface MantleClient {
  service<T>(path: string): ServiceClient<T>;
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
  on(event: 'created' | 'updated' | 'patched' | 'removed', handler: (data: T) => void): this;
  off(event: 'created' | 'updated' | 'patched' | 'removed', handler: (data: T) => void): this;
}

interface ClientParams {
  query?: Record<string, unknown>;
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
```

#### Transport routing

- Standard CRUD methods (`find`, `get`, `create`, `update`, `patch`, `remove`) use REST by default (`fetch`)
- `ClientParams.query` is serialized as query string parameters for `find` and `get`
- Real-time subscriptions (`on('created', ...)`) use `socket.io-client` when `socket` option is configured
- If `socket` is omitted, `ServiceClient.on()` throws `GeneralError` at call time (not at construction)
- Socket connects lazily on the first `.on()` call

#### Authentication

```typescript
const client = mantle({ url: 'http://localhost:3030' });

// Local strategy
await client.authenticate({ strategy: 'local', email: 'user@example.com', password: 'secret' });

// Subsequent requests automatically include Authorization: Bearer <token>
const profile = await client.service<User>('users').get('me');
```

Token storage:
- Browser: `localStorage` by default (configurable to `sessionStorage` or custom `TokenStorage`)
- Node.js / React Native: in-memory by default (configurable to a custom `TokenStorage` implementation)

The access token is automatically attached to REST requests as `Authorization: Bearer <token>`. On 401 responses, the client attempts a token refresh via `POST /authentication/refresh` using the stored refresh token before retrying once. If the refresh fails, the client throws `NotAuthenticated` and emits a `'logout'` event.

#### Real-time subscriptions

```typescript
const client = mantle({
  url: 'http://localhost:3030',
  socket: { transports: ['websocket'] },
});

// Subscribe to service events
client.service<Message>('messages').on('created', (msg) => {
  console.log('New message:', msg);
});

// Unsubscribe
client.service<Message>('messages').off('created', handler);
```

Each service shares a single underlying socket connection. Subscribing to `on()` on multiple services does not open additional connections.

#### Error handling

Server error responses (non-2xx) are deserialized into a typed `MantleClientError`:

```typescript
interface MantleClientError extends Error {
  code: number;      // HTTP status code
  name: string;      // 'BadRequest' | 'NotAuthenticated' | 'Forbidden' | 'NotFound' | ...
  message: string;
  data?: unknown;
  errors?: unknown[];
}
```

```typescript
try {
  await client.service('users').get('nonexistent');
} catch (err) {
  if (err.code === 404) console.log('Not found');
}
```

---

### `@mantlejs/react`

React hooks for Mantle services, built on **TanStack Query** (React Query v5).

**Dependencies:** `@mantlejs/client`, `@tanstack/react-query`

```typescript
// Provider — wraps the app once
function MantleProvider(props: {
  client: MantleClient;
  queryClient?: QueryClient;   // Optional — creates a default QueryClient if not provided
  children: ReactNode;
}): JSX.Element;

// Client access
function useMantleClient(): MantleClient;

// Query hooks — mirror the Service<T> read methods
function useFind<T>(
  service: string,
  params?: ClientParams,
  options?: UseQueryOptions<T[]> & { realtime?: boolean }
): UseQueryResult<T[]>;

function useGet<T>(
  service: string,
  id: Id,
  params?: ClientParams,
  options?: UseQueryOptions<T> & { realtime?: boolean }
): UseQueryResult<T>;

// Mutation hooks — mirror the Service<T> write methods
function useCreate<T>(
  service: string,
  options?: UseMutationOptions<T, MantleClientError, Partial<T>>
): UseMutationResult<T, MantleClientError, Partial<T>>;

function useUpdate<T>(
  service: string,
  options?: UseMutationOptions<T, MantleClientError, { id: Id; data: Partial<T> }>
): UseMutationResult<T, MantleClientError, { id: Id; data: Partial<T> }>;

function usePatch<T>(
  service: string,
  options?: UseMutationOptions<T, MantleClientError, { id: Id; data: Partial<T> }>
): UseMutationResult<T, MantleClientError, { id: Id; data: Partial<T> }>;

function useRemove<T>(
  service: string,
  options?: UseMutationOptions<T, MantleClientError, Id>
): UseMutationResult<T, MantleClientError, Id>;
```

#### Query keys

| Hook | Query key |
|---|---|
| `useFind('messages', params)` | `['messages', 'find', params]` |
| `useGet('messages', id, params)` | `['messages', 'get', id, params]` |

#### Real-time cache invalidation

When `@mantlejs/client` is configured with a socket, `@mantlejs/react` registers service event listeners on mount of the first hook for a given service. When a `created`, `updated`, `patched`, or `removed` event arrives, the hook calls:

```typescript
queryClient.invalidateQueries({ queryKey: [service] });
```

This causes all active `useFind` and `useGet` queries for that service to refetch in the background, keeping the UI consistent without manual cache management.

- Opt out per hook via `realtime: false` in options
- If the client has no socket configured, real-time invalidation is silently disabled (no error)
- Event listeners are cleaned up when all hooks for a service unmount

#### Typical usage

```typescript
import { MantleProvider, useFind, useCreate } from '@mantlejs/react';
import { mantle } from '@mantlejs/client';

const client = mantle({ url: 'http://localhost:3030', socket: {} });

function App() {
  return (
    <MantleProvider client={client}>
      <Messages />
    </MantleProvider>
  );
}

function Messages() {
  const { data: messages, isLoading } = useFind<Message>('messages');
  const createMessage = useCreate<Message>('messages');

  if (isLoading) return <p>Loading…</p>;

  return (
    <>
      {messages?.map(m => <p key={m.id}>{m.text}</p>)}
      <button onClick={() => createMessage.mutate({ text: 'Hello' })}>Send</button>
    </>
  );
}
```

---

### First npm Release

All Mantle packages (Phase 1–4) are published to the public npm registry at version `0.1.0` in dependency order.

#### Release checklist

- All packages pass `npx nx run-many -t build,test,lint` with zero errors
- Each package `package.json` has: `"publishConfig": { "access": "public" }`, correct `"main"`, `"module"`, `"types"`, `"exports"` fields, and `"files": ["dist"]`
- All README files are complete (installation, usage, API)
- Root `README.md` links to all packages
- Version is set to `0.1.0` across all packages with consistent `peerDependencies` ranges
- Published in dependency order: `@mantlejs/mantle` first, then adapters, then `@mantlejs/client`, then `@mantlejs/react` last

---

## Package Structure Additions

```text
mantle/
├── packages/
│   ├── [all Phase 1 + Phase 2 + Phase 3 packages]
│   ├── client/          @mantlejs/client       [NEW P4]
│   └── react/           @mantlejs/react        [NEW P4]
```

### Updated Package Dependency Rules (Phase 4 additions)

| Package | May depend on |
|---|---|
| `@mantlejs/client` | nothing (optional types-only peer on `@mantlejs/mantle`) |
| `@mantlejs/react` | `@mantlejs/client`, `@tanstack/react-query` |

---

## Developer Experience Principles

Phase 4 upholds all Phase 1–3 principles and adds:

**15. Consistent Client API** — `@mantlejs/client` exposes the same `find`, `get`, `create`, `update`, `patch`, `remove` method names developers know from the server-side `Service<T>`. Switching between server and client service calls involves minimal context switching.

**16. Real-Time Out of the Box** — `@mantlejs/react` wires real-time events directly into TanStack Query's cache. A server mutation causes an automatic background refetch on every mounted component that renders that service's data — no manual cache invalidation, no subscriptions to manage.

**17. Zero Server-Side Knowledge Required** — `@mantlejs/client` works against any Mantle server without importing server-side packages. Bundle size stays under 20 KB gzipped (excluding `socket.io-client`).

---

## Success Metrics

| Metric | Phase 4 Target |
|---|---|
| Client bundle size | < 20 KB gzipped (excluding `socket.io-client`) |
| React real-time invalidation latency | < 100 ms from server mutation to UI refetch |
| Token refresh | 401 → refresh → retry completes transparently in < 500 ms |
| npm publish | All packages successfully published and resolvable via `npm install @mantlejs/<name>` |
| First-install DX | `npm install @mantlejs/client @mantlejs/react` + copy-paste snippet → working real-time UI |

---

## Architectural & Design Decisions

| # | Question | Decision |
|---|---|---|
| 1 | One `@mantlejs/client` or split REST + Socket.io? | **One package.** `socket.io-client` is an optional peer dependency — tree-shaken when unused. A unified client gives better UX (one install, one API surface) and matches FeathersJS's `@feathersjs/client`. |
| 2 | React hooks — TanStack Query vs roll-our-own? | **TanStack Query v5.** Rolling our own means reimplementing caching, background refetch, stale-while-revalidate, and optimistic updates. TanStack Query is the de facto standard; socket events map cleanly to `queryClient.invalidateQueries()`. |
| 3 | Token storage — `localStorage` vs `httpOnly` cookie? | **`localStorage` by default** with a pluggable `TokenStorage` interface. `httpOnly` cookies require server cooperation and complicate React Native support. Teams needing cookie-based storage can implement the `TokenStorage` interface. |
| 4 | Socket connection — eager vs lazy? | **Lazy.** Socket connects on the first `ServiceClient.on()` call. Clients that only use REST never open a socket connection, keeping bundle weight and network overhead zero for pure REST use cases. |
| 5 | Real-time invalidation — per-record vs per-service? | **Per-service (`queryKey: [service]`).** Per-record invalidation (`queryKey: [service, 'get', id]`) risks stale list views after creates/deletes. Invalidating the entire service key is safe, predictable, and allows TanStack Query's background refetch to deduplicate requests. |
| 6 | `MantleProvider` — require a `QueryClient` prop? | **Optional.** `MantleProvider` creates a default `QueryClient` with sensible defaults when none is provided. Teams already using TanStack Query pass their own `QueryClient` to share state with non-Mantle queries. |
| 7 | Error type — extend `MantleError` or standalone? | **Standalone `MantleClientError`.** `@mantlejs/client` has no hard dependency on `@mantlejs/mantle`. The client reconstructs error shape from the JSON response. Teams can add `@mantlejs/mantle` as a peer and check `instanceof` if needed. |
| 8 | npm release versioning — `0.1.0` or `1.0.0`? | **`0.1.0`.** The `0.x` range signals an evolving API. A `1.0.0` release implies stability guarantees Mantle is not yet ready to commit to. Semver minor bumps (`0.2.0`) allow breaking changes under `0.x`. |
