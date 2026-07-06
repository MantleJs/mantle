# Product Requirements Document
# Mantle JS — Phase 4

**Version:** 0.4.0-draft
**Status:** Planning
**License:** MIT
**Last Updated:** 2026-07-05
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

Phase 3 completed the server-side ecosystem: transports (Koa, plain HTTP), OAuth strategies, NoSQL/vector/graph database adapters, real-time scaling with `@mantlejs/sync`, and CLI tooling. Phase 4 closes the loop with the client-side story and closes the remaining functional-parity gaps against FeathersJS identified in [`feathersjs-full-parity-comparison.md`](../decisions/feathersjs-full-parity-comparison.md).

Phase 4 delivers six packages/features and the first public npm release:

1. **`@mantlejs/client`** — official browser/Node.js/React Native SDK with REST (`fetch`) and real-time (`socket.io-client`) transport
2. **`@mantlejs/react`** — React hooks for Mantle services, built on TanStack Query v5 with automatic real-time cache invalidation
3. **`@mantlejs/mongodb`** — MongoDB Atlas / self-hosted MongoDB adapter implementing `Repository<T>` (official `mongodb` driver)
4. **`@mantlejs/openapi`** — OpenAPI 3.1 spec generation from registered services + `@mantlejs/schema` TypeBox definitions
5. **Batch requests** — server-side `POST /batch` endpoint (core + transports) and client-side call coalescing in `@mantlejs/client`, aimed at both general efficiency and AI-agent callers that fire many related calls per turn
6. **CORS** — first-class, opt-in CORS configuration for `@mantlejs/express`, `@mantlejs/koa`, and `@mantlejs/http`
7. **Upload read/delete** — `StorageAdapter` gains `retrieve()`, `delete()`, and `getSignedUrl()` alongside the existing write-only `store()`
8. **First npm release** — a curated set of Mantle packages published to the public npm registry at `0.1.0`, others tagged `0.1.0-experimental` (see [Publish Tiering](#publish-tiering))

Phase 4 package summary:

| Package | Purpose |
|---|---|
| `@mantlejs/client` | Browser + Node.js client SDK — REST + Socket.io + batch coalescing |
| `@mantlejs/react` | React hooks for Mantle services (TanStack Query v5) |
| `@mantlejs/mongodb` | MongoDB Atlas / MongoDB `Repository<T>` adapter (official driver, no Mongoose) |
| `@mantlejs/openapi` | OpenAPI 3.1 spec generation + optional Swagger UI mount |
| `@mantlejs/express`, `@mantlejs/koa`, `@mantlejs/http` (additions) | `cors` configure option; `POST /batch` route |
| `@mantlejs/storage` (additions) | `StorageAdapter.retrieve()` / `.delete()` / `.getSignedUrl()` |

---

## Goals & Non-Goals

### Goals

- Ship `@mantlejs/client` — a first-party client SDK usable in browser, Node.js (18+), and React Native
- Implement REST-first transport with `fetch`, real-time subscriptions via `socket.io-client` (optional peer dep)
- Implement automatic token storage, refresh, and `Authorization` header injection
- Deserialize server error responses into typed `MantleClientError` objects
- Ship `@mantlejs/react` with TanStack Query v5 integration: `useFind`, `useGet`, `useCreate`, `useUpdate`, `usePatch`, `useRemove`
- Implement automatic real-time cache invalidation: service socket events call `queryClient.invalidateQueries`
- Ship `@mantlejs/mongodb` — `Repository<T>` adapter over the official `mongodb` driver, targeting MongoDB Atlas as the primary deployment path
- Ship `@mantlejs/openapi` — generate an OpenAPI 3.1 spec from registered services and `@mantlejs/schema` definitions
- Add a `POST /batch` endpoint (core dispatch logic + per-transport route) and client-side call coalescing in `@mantlejs/client`
- Add opt-in CORS configuration to `@mantlejs/express`, `@mantlejs/koa`, and `@mantlejs/http`
- Extend `StorageAdapter` with `retrieve()`, `delete()`, and `getSignedUrl()` across disk/S3/GCS backends
- First public npm release of a curated package set at version `0.1.0`, with the rest tagged `0.1.0-experimental`

### Non-Goals (Phase 4)

- No GraphQL transport (Phase 5)
- No rate limiting plugin (Phase 5)
- No multi-tenancy primitives (Phase 5)
- No Vue 3 composables or Svelte/SolidJS hooks (Phase 5 or community)
- No AWS Neptune, Azure Cosmos DB, or ArangoDB adapters (Phase 5 — multi-cloud)
- No Mongoose adapter — `@mantlejs/mongodb` uses the official driver directly, consistent with the query-builder-not-ORM
  philosophy applied to `@mantlejs/knex`; Mongoose support remains community territory
- No Prisma adapter (community)
- No `@mantlejs/angular` or `@mantlejs/solid` (community or Phase 5)
- No true cross-database atomicity in batch requests — a batch spanning services backed by different databases
  cannot be rolled back as one transaction; each call succeeds or fails independently (see Batch spec below)

---

## Phase 4 Package Specifications

---

### `@mantlejs/mongodb`

`Repository<T>` adapter over the official `mongodb` driver — no Mongoose, consistent with the query-builder-not-ORM
approach `@mantlejs/knex` already takes for SQL. Primary deployment target is MongoDB Atlas; works unchanged against
any MongoDB 6+ server (self-hosted, Atlas, DocumentDB-compatible endpoints on a best-effort basis).

**Dependencies:** `@mantlejs/mantle`, `mongodb`

```typescript
export abstract class MongoRepository<T extends Record<string, unknown>, D = Partial<T>> implements Repository<T, D> {
  abstract readonly collectionName: string;

  /** @default true — read/write `createdAt`/`updatedAt` as Date fields */
  readonly timestamps: boolean = true;

  constructor(app: MantleApplication);

  findAll(params?: QueryParams): Promise<T[]>;
  findById(id: Id): Promise<T | null>;
  save(data: D): Promise<T>;
  saveAll(data: D[]): Promise<T[]>;
  updateById(id: Id, data: D): Promise<T>;
  patchById(id: Id, data: D): Promise<T>;
  deleteById(id: Id): Promise<T>;
  count(params?: QueryParams): Promise<number>;

  /** Run a block of repository calls inside a MongoDB session/transaction (requires a replica set or Atlas cluster). */
  withTransaction<R>(fn: (txRepo: this) => Promise<R>): Promise<R>;

  /** Escape hatch — the underlying `Collection<T>` for driver-native queries. */
  protected readonly collection: Collection<T>;
}
```

**`QueryParams` → MongoDB translation:** the existing `where` operators map almost directly onto MongoDB query
operators (`$lt`, `$lte`, `$gt`, `$gte`, `$in`, `$nin`, `$or`, `$and`, `$ne` are native MongoDB syntax already);
`$like`/`$ilike`/`$notlike` (PostgreSQL-only in `@mantlejs/knex`) are **not** supported here and throw `BadRequest`
if used — use `$regex` via a raw `collection` query for pattern matching instead.

**ID handling:** Mongo's native `_id` is an `ObjectId`. `MongoRepository` accepts and returns `id` as a `string`
(hex representation) at the `Repository<T>` boundary, converting to/from `ObjectId` internally — the same
"stable string `Id` at the interface, adapter-specific internally" pattern used by `DynamoDbRepository`'s
partition-key handling.

---

### `@mantlejs/openapi`

Generates an OpenAPI 3.1 document from registered services and their `@mantlejs/schema` (TypeBox) definitions, and
optionally mounts a Swagger UI (or Scalar) page. Because `@mantlejs/schema` already uses TypeBox — whose schemas
are valid JSON Schema — spec generation is a direct mapping rather than the runtime-inference approach
`feathers-swagger` has to take against looser schema definitions.

**Dependencies:** `@mantlejs/mantle`, `@mantlejs/schema` (peer, for schema-derived specs)

```typescript
function openapi(options: OpenApiOptions): (app: MantleApplication) => void;

interface OpenApiOptions {
  /** OpenAPI `info.title`. */
  title: string;
  /** OpenAPI `info.version` — defaults to the app's package.json version if resolvable. */
  version?: string;
  /** `servers[]` entries. */
  servers?: { url: string; description?: string }[];
  /** Path the generated spec is served at. @default "/openapi.json" */
  specPath?: string;
  /** Mount an interactive docs UI at this path. Omit to skip UI generation (spec-only). */
  docsPath?: string;
  /** Per-service overrides — tag grouping, summary text, or full exclusion from the spec. */
  services?: Record<string, { tag?: string; summary?: string; hidden?: boolean }>;
}
```

**Schema resolution:** for each registered service, `@mantlejs/openapi` inspects the service's hooks for a
`@mantlejs/schema` `validate()` call and, if present, uses its TypeBox schema as the `requestBody`/response schema
for `create`/`update`/`patch`. Services without a registered schema still appear in the spec with a generic
`object` schema — the generator degrades gracefully rather than requiring 100% schema coverage to produce output.

**Auth integration:** if `@mantlejs/auth` is configured, `@mantlejs/openapi` adds a `bearerAuth` security scheme
and applies it to any service with an `authenticate('jwt')` hook in its `before.all` pipeline — inferred from the
hook pipeline, not manually declared.

---

### Batch Requests

Two complementary pieces: a server-side batch endpoint (works with any client, including `curl`/agents constructing
raw HTTP) and opt-in call coalescing inside `@mantlejs/client` (so application code doesn't need to hand-construct
batch payloads to benefit).

#### Server: `POST /batch`

Core dispatch logic lives in `@mantlejs/mantle` (`app.batch(calls)`); each transport package (`express`, `koa`,
`http`) wires a `POST /batch` route that calls it. Each call in the batch is dispatched through the **same hook
pipeline** as an individually-routed call — batch is not a way to bypass authentication or validation.

```typescript
interface BatchCall {
  service: string;
  method: "find" | "get" | "create" | "update" | "patch" | "remove";
  id?: Id;
  data?: unknown;
  params?: QueryParams;
}

interface BatchResult {
  status: "success" | "error";
  result?: unknown;
  error?: { name: string; message: string; code: number };
}

function batch(calls: BatchCall[]): Promise<BatchResult[]>; // app.batch()
```

- Results are returned in the same order as the request array.
- Calls execute **concurrently by default** (`Promise.allSettled` semantics) — order of *execution* is not
  guaranteed, only order of the *results* array.
- One call failing does not fail the batch — each entry independently reports `success` or `error`. There is no
  cross-call atomicity: a batch spanning multiple services (potentially multiple databases) cannot be rolled back
  as a unit. Teams needing atomicity across calls to the *same* repository should use `withTransaction()` inside a
  single custom service method instead.
- Default max batch size: **25** calls per request, configurable via transport options; requests exceeding the
  limit are rejected with `BadRequest` before any call executes.

#### Client: call coalescing

```typescript
interface ClientOptions {
  // ...existing fields
  /** Coalesce calls made within the same window into one POST /batch request. @default false */
  batch?: boolean | { windowMs?: number; maxSize?: number };
}
```

When enabled, `ServiceClient` calls made within the same coalescing window (default: same microtask tick, `windowMs`
overridable) are queued and sent as a single `POST /batch` request instead of N separate REST calls; each caller's
promise resolves independently once the batch response returns. Default `windowMs` is small enough (0 — same tick)
that it does not add perceptible latency to a single, non-batched call. This is aimed squarely at AI agent
call patterns, where a single turn frequently issues several related `get`/`find` calls back to back.

---

### CORS

Opt-in CORS configuration added to `@mantlejs/express`, `@mantlejs/koa`, and `@mantlejs/http`. Disabled by default —
consistent with Mantle's secure-by-default posture elsewhere (e.g. auth requires explicit strategy configuration).

```typescript
express({ cors: true });                                   // permissive default (reflects Origin, all methods)
express({ cors: { origin: ["https://app.example.com"], credentials: true } });
```

Implementation is transport-native: `@mantlejs/express` wraps the `cors` npm package, `@mantlejs/koa` wraps
`@koa/cors`, `@mantlejs/http` implements the equivalent header-setting logic directly (no framework to delegate to).
Option shape is normalized across all three so switching transports doesn't require relearning CORS configuration.

---

### `@mantlejs/storage` — read/delete extension

`StorageAdapter` currently only defines `store()` — there is no way to read a file back or delete it through
Mantle once uploaded. Phase 4 extends the interface across all three storage backends (disk, S3, GCS):

```typescript
export interface UploadedFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  path: string;
  /** Storage-adapter-specific key/identifier — always present, used by retrieve()/delete()/getSignedUrl(). */
  key: string;
}

export interface StorageAdapter {
  store(stream: Readable, info: UploadFileInfo): Promise<UploadedFile>;
  /** Stream a previously stored file back by its `key`. */
  retrieve(key: string): Promise<Readable>;
  /** Permanently remove a previously stored file. */
  delete(key: string): Promise<void>;
  /** Generate a time-limited direct-download URL. Optional — disk storage has no meaningful signed URL and omits it. */
  getSignedUrl?(key: string, options?: { expiresIn?: number }): Promise<string>;
}
```

`UploadedFile.path` today is a full URL for S3/GCS (assumes a public-read bucket) with no way to reference the
underlying object key for a *private* bucket. Adding `key` closes that gap — `path` remains for display purposes,
`key` is the canonical identifier passed to `retrieve()`/`delete()`/`getSignedUrl()`. This is a breaking change to
`UploadedFile`; since no package has shipped to npm yet, it ships as a plain interface change rather than a
deprecation cycle.

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
- **Finalize the publish-tier list** (see [Publish Tiering](#publish-tiering)) — confirm which packages ship `0.1.0` vs `0.1.0-experimental` based on test coverage and real-world usage at release time, not the working split drafted during planning
- Version is set to `0.1.0` (stable tier) or `0.1.0-experimental` (experimental tier) across all packages with consistent `peerDependencies` ranges
- Published in dependency order: `@mantlejs/mantle` first, then adapters, then `@mantlejs/client`, then `@mantlejs/react` last

---

## Package Structure Additions

```text
mantle/
├── packages/
│   ├── [all Phase 1 + Phase 2 + Phase 3 packages]
│   ├── client/          @mantlejs/client       [NEW P4]
│   ├── react/           @mantlejs/react        [NEW P4]
│   ├── mongodb/         @mantlejs/mongodb      [NEW P4]
│   └── openapi/         @mantlejs/openapi      [NEW P4]
```

CORS, batch, and the upload read/delete extension are additions to existing packages (`express`, `koa`, `http`,
`upload`) rather than new packages.

### Updated Package Dependency Rules (Phase 4 additions)

| Package | May depend on |
|---|---|
| `@mantlejs/client` | nothing (optional types-only peer on `@mantlejs/mantle`) |
| `@mantlejs/react` | `@mantlejs/client`, `@tanstack/react-query` |
| `@mantlejs/mongodb` | `@mantlejs/mantle`, `mongodb` |
| `@mantlejs/openapi` | `@mantlejs/mantle`, `@mantlejs/schema` (peer) |

---

## Developer Experience Principles

Phase 4 upholds all Phase 1–3 principles and adds:

**15. Consistent Client API** — `@mantlejs/client` exposes the same `find`, `get`, `create`, `update`, `patch`, `remove` method names developers know from the server-side `Service<T>`. Switching between server and client service calls involves minimal context switching.

**16. Real-Time Out of the Box** — `@mantlejs/react` wires real-time events directly into TanStack Query's cache. A server mutation causes an automatic background refetch on every mounted component that renders that service's data — no manual cache invalidation, no subscriptions to manage.

**17. Zero Server-Side Knowledge Required** — `@mantlejs/client` works against any Mantle server without importing server-side packages. Bundle size stays under 20 KB gzipped (excluding `socket.io-client`).

**18. Efficient for Agent Callers, Not Just Humans** — the `POST /batch` endpoint and `@mantlejs/client` call coalescing mean a caller making many small related requests in one turn (the dominant pattern for AI agents driving a Mantle API) costs one round trip instead of N, without changing how any individual service call is written.

**19. Self-Documenting by Default** — `@mantlejs/openapi` generates a spec from services and schemas that already exist; there is no separate documentation artifact to keep in sync by hand.

---

## Success Metrics

| Metric | Phase 4 Target |
|---|---|
| Client bundle size | < 20 KB gzipped (excluding `socket.io-client`) |
| React real-time invalidation latency | < 100 ms from server mutation to UI refetch |
| Token refresh | 401 → refresh → retry completes transparently in < 500 ms |
| npm publish | All stable-tier packages successfully published and resolvable via `npm install @mantlejs/<name>` |
| First-install DX | `npm install @mantlejs/client @mantlejs/react` + copy-paste snippet → working real-time UI |
| `@mantlejs/mongodb` parity | Passes the same `Repository<T>` contract test suite already run against Knex/DynamoDB/Supabase |
| `@mantlejs/openapi` accuracy | Generated spec validates against the OpenAPI 3.1 JSON Schema; imports cleanly into Postman/Insomnia |
| Batch efficiency | 10 sequential `useGet` calls from an agent-style caller collapse into 1 request with `batch` enabled |
| CORS | A browser app on a different origin can call a Mantle service with zero manual header wiring once `cors: true` is set |

---

## Publish Tiering

Phase 3's original plan was to publish all 20+ packages at `0.1.0` in one pass. That's still the eventual goal, but
newer adapters (DynamoDB, Supabase, Pinecone, Qdrant, Neo4j, `@mantlejs/sync`) haven't had the runtime hardening or
real-world usage that `@mantlejs/mantle`, `@mantlejs/express`, `@mantlejs/knex`, and the auth/upload packages have.
Publishing everything at the same confidence level overstates how battle-tested the newer adapters are.

**Decision: curated core at `0.1.0`, remaining packages tagged `0.1.0-experimental`.**

Working split (subject to final confirmation — see the checklist item below, this list is re-reviewed right before
the actual `npm publish` run, not locked in at planning time):

| Tier | Packages |
|---|---|
| **Stable `0.1.0`** | `@mantlejs/mantle`, `@mantlejs/express`, `@mantlejs/koa`, `@mantlejs/http`, `@mantlejs/knex`, `@mantlejs/auth`, `@mantlejs/auth-local`, `@mantlejs/auth-oauth`, `@mantlejs/auth-google`, `@mantlejs/auth-github`, `@mantlejs/auth-facebook`, `@mantlejs/storage`, `@mantlejs/storage-s3`, `@mantlejs/storage-gcs`, `@mantlejs/logger`, `@mantlejs/schema`, `@mantlejs/memory`, `@mantlejs/config`, `@mantlejs/socketio`, `@mantlejs/supabase`, `@mantlejs/sync`, `@mantlejs/client`, `@mantlejs/react`, `@mantlejs/cli`, `create-mantle` |
| **`0.1.0-experimental`** | `@mantlejs/dynamodb`, `@mantlejs/pinecone`, `@mantlejs/qdrant`, `@mantlejs/neo4j`, `@mantlejs/mongodb`, `@mantlejs/openapi` |

`upload`/`upload-s3`/`upload-gcs`, `@mantlejs/supabase`, and `@mantlejs/sync` are pulled into the stable tier
despite being newer, because they're load-bearing for common real-time/multi-tenant deployment shapes and have
had focused test coverage already. `@mantlejs/mongodb` and `@mantlejs/openapi` ship experimental in their first
pass since they're new in this same phase — no adapter goes straight to stable in the phase it's introduced.

`0.1.0-experimental` is a real, installable, resolvable npm version — not a withheld package. It signals "usable,
less road-tested" rather than gatekeeping access. Promotion from experimental to stable happens in a follow-up
release once an adapter has production usage reports, not on a fixed timeline.

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
| 9 | MongoDB — reverse the Phase 3 decision to skip it? | **Yes, add `@mantlejs/mongodb`.** The Phase 3 reasoning (DynamoDB fits serverless/Cloud Run better) is still true for green-field deployments, but it undercounted teams migrating an *existing* MongoDB Atlas cluster onto Mantle — for that audience "no MongoDB adapter" is a hard adoption blocker, not a design nicety. Uses the official driver directly, not Mongoose, to preserve the query-builder-not-ORM stance. |
| 10 | OpenAPI generation — pull into Phase 4 or hold for Phase 5? | **Pull into Phase 4.** `@mantlejs/schema` already emits TypeBox schemas, which are valid JSON Schema — the marginal cost of an OpenAPI generator is much lower than it would be without that foundation already in place, and API documentation is consistently one of the top asks for teams shipping a service to external consumers. |
| 11 | Batch requests — server endpoint, client coalescing, or both? | **Both.** A server-only endpoint forces every caller to hand-construct batch payloads; client-only coalescing does nothing for non-JS callers (curl, other languages, most AI agent runtimes) constructing raw HTTP. Shipping both means the endpoint is useful standalone and `@mantlejs/client` users get it for free. |
| 12 | Batch atomicity — attempt cross-service transactions? | **No.** A batch can span services backed by different databases (e.g. Postgres + Mongo) with no shared transaction coordinator. Promising atomicity there would be a lie. Each call reports success/error independently; same-repository atomicity is already available via `withTransaction()` inside a single custom service method. |
| 13 | CORS — on by default or opt-in? | **Opt-in**, matching the rest of Mantle's security posture (auth requires explicit strategy configuration; nothing is permissive by default). `cors: true` is one line when a team does want it. |
| 14 | Upload `path` vs `key` — is this a breaking change worth taking now? | **Yes.** `StorageAdapter` hasn't shipped to npm yet (Phase 4 is the first public release), so there's no deprecation cycle to manage. Fixing the missing read/delete surface now avoids carrying a broken read path into the public API. |
| 15 | Publish everything at `0.1.0`, or tier by confidence? | **Tier.** Publishing 20+ packages at the same version number implies the same confidence level across all of them, which isn't true — newer adapters (Pinecone, Qdrant, Neo4j, DynamoDB, and the two packages introduced this same phase, MongoDB and OpenAPI) haven't had comparable real-world usage to `@mantlejs/knex` or `@mantlejs/express`. An `0.1.0-experimental` tag is honest about that without withholding the package. |
| 16 | Graph query strategy — a second query language for `GraphRepository<T>`? | **No new abstraction needed.** `GraphRepository<T>` (shipped Phase 3) already exposes both a `QueryParams`-shaped `findNodes()` for the common case and a raw `cypher()` escape hatch for anything `QueryParams` can't express — the same pattern `KnexRepository` uses for raw SQL. Vector (`findSimilar`) and graph (`traverse`, `cypher`) repositories extending the base `Repository<T>` rather than replacing it keeps one mental model across all database adapters. |
