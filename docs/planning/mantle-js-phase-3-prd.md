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

Phase 2 made Mantle production-ready: logging, schema validation, real-time via Socket.io, cloud storage, and OAuth. Phase 3 expands Mantle's reach in four directions:

1. **Ecosystem completeness** — Koa transport, plain HTTP adapter, Facebook OAuth, `@mantlejs/mantle` package rename (done), and `create-mantle` for frictionless project creation
2. **Client SDKs** — first-party browser/Node.js client with REST + Socket.io, and React hooks built on TanStack Query
3. **Database breadth** — MongoDB (native driver), vector databases (Pinecone, Qdrant, pgvector extension), and graph databases (Neo4j)
4. **Horizontal scaling** — cross-instance socket event replication via `@mantlejs/sync`

Phase 3 also closes the CLI gap with `mantle add` (install a package and wire it into `app.ts`) and additional generators.

Phase 3 package summary:

| Package | Purpose |
|---|---|
| `create-mantle` | `npm create mantle` project initializer (thin wrapper over `@mantlejs/cli`) |
| `@mantlejs/cli` (additions) | `mantle add`, auth generator, migration generator |
| `@mantlejs/koa` | Koa HTTP transport adapter |
| `@mantlejs/http` | Plain Node.js `http` / fetch-compatible edge/serverless adapter |
| `@mantlejs/auth-facebook` | Facebook OAuth 2.0 strategy |
| `@mantlejs/client` | Browser + Node.js client SDK — REST + Socket.io |
| `@mantlejs/react` | React hooks for Mantle services (TanStack Query) |
| `@mantlejs/mongodb` | MongoDB adapter implementing `Repository<T>` (native driver) |
| `@mantlejs/pinecone` | Pinecone vector database adapter |
| `@mantlejs/qdrant` | Qdrant vector database adapter |
| `@mantlejs/pgvector` | pgvector extension for `@mantlejs/knex` — adds `findSimilar` |
| `@mantlejs/neo4j` | Neo4j graph database adapter |
| `@mantlejs/sync` | Cross-instance service event replication via Redis |

---

## Goals & Non-Goals

### Goals

- `npm create mantle my-api` — zero-friction project creation, no global install required
- `mantle add <package>` — install a Mantle package and wire it into the existing `app.ts`
- Add Koa and plain HTTP as first-class transports alongside Express
- Add Facebook as a supported OAuth strategy
- Ship a first-party client SDK (`@mantlejs/client`) usable in browser, Node.js, and React Native
- Ship `@mantlejs/react` with TanStack Query integration for `useFind`, `useGet`, `useCreate`, etc.
- Add MongoDB via the native driver (no Mongoose)
- Add vector database adapters: Pinecone, Qdrant, and pgvector (PostgreSQL extension)
- Add Neo4j as the first graph database adapter
- Enable horizontal scaling: a mutation on any instance reaches socket clients on all instances
- Establish `VectorRepository<T>` and `GraphRepository<T>` interface extensions in `@mantlejs/mantle`

### Non-Goals (Phase 3)

- No publishing to npm — deferred to Phase 4
- No GraphQL transport (Phase 4)
- No OpenAPI/Swagger auto-generation (Phase 4)
- No rate limiting plugin (Phase 4)
- No multi-tenancy primitives (Phase 4)
- No Prisma or Mongoose adapters (community or Phase 4)
- No AWS Neptune, Azure Cosmos DB, or ArangoDB adapters (Phase 4 — multi-cloud)
- No DynamoDB adapter (Phase 4 — key-value/document hybrid, lower demand)
- No AMQP/RabbitMQ sync adapter (community adapter can implement `SyncAdapter`)
- No sticky session management — leave to load balancer configuration

---

## Phase 3 Package Specifications

---

### `create-mantle`

Enables `npm create mantle my-api` without a global install. Published as an **unscoped** npm package (`create-mantle`) so npm's `create` convention resolves it correctly.

**Dependencies:** `@mantlejs/cli` (thin wrapper only)

#### Behaviour

`npm create mantle my-api` is equivalent to `npx @mantlejs/cli new my-api`. The `create-mantle` package is a minimal entry point that delegates to the `newProject()` function already implemented in `@mantlejs/cli`.

```bash
npm create mantle my-api
# Prompts for database, auth, package manager — same as `mantle new`
```

The package's `bin.create-mantle` entry point forwards all argv to the `newProject()` function. No duplication of template logic.

---

### `@mantlejs/cli` — Phase 3 additions

Three additions to the existing CLI:

#### `mantle add <package>`

Installs a Mantle package and modifies `src/app.ts` to wire it in automatically.

```bash
mantle add @mantlejs/logger
mantle add @mantlejs/socketio
mantle add @mantlejs/auth-google
```

**Implementation:**
1. Run `npm install @mantlejs/<package>` (or yarn/pnpm — detected from lockfile)
2. Locate `src/app.ts` in the current directory
3. Parse `src/app.ts` using the TypeScript compiler API (AST manipulation, not regex)
4. Insert the import declaration at the top
5. Append `.configure(plugin(options))` to the `mantle()` call chain
6. Write the modified file back

Each recognized package has a wiring template:

| Package | Import | Configure call |
|---|---|---|
| `@mantlejs/logger` | `import pino from 'pino'; import { logger, pinoAdapter } from '@mantlejs/logger';` | `.configure(logger(pinoAdapter(pino({ level: process.env.LOG_LEVEL ?? 'info' }))))` |
| `@mantlejs/socketio` | `import { socketio } from '@mantlejs/socketio';` | `.configure(socketio())` |
| `@mantlejs/auth` | `import { auth } from '@mantlejs/auth';` | `.configure(auth({ secret: process.env.JWT_SECRET! }))` |
| `@mantlejs/auth-google` | `import { googleStrategy } from '@mantlejs/auth-google';` | `.configure(googleStrategy({ clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! }))` |
| `@mantlejs/sync` | `import { sync, redisAdapter } from '@mantlejs/sync';` | `.configure(sync({ adapter: redisAdapter({ url: process.env.REDIS_URL }) }))` |

Unknown packages print a human-readable message explaining the import and configure step without modifying the file.

#### `mantle generate authentication`

Generates authentication configuration in an existing project. Detects which auth packages are installed and generates the appropriate wiring.

```bash
mantle g authentication
```

Generates `src/authentication.ts` with the strategy configuration and outputs instructions for wiring into `app.ts`.

#### `mantle generate migration <name>`

Generates a Knex migration file (requires `@mantlejs/knex` to be installed).

```bash
mantle g migration create-users-table
```

Writes to `migrations/<timestamp>_<name>.ts` following Knex migration conventions.

---

### `@mantlejs/koa`

Koa HTTP transport adapter. Registers service routes on a Koa application and sets `params.provider = 'koa'`.

**Dependencies:** `@mantlejs/mantle`, `koa`, `@koa/router`

```typescript
function koa(options?: KoaOptions): MantlePlugin;

interface KoaOptions {
  /** Koa app instance. If not provided, one is created internally. Default: new Koa() */
  app?: Koa;
  /** Middleware applied before service routing. */
  middleware?: Koa.Middleware[];
}
```

#### Route registration

`koa()` registers the same REST route structure as `express()`:

| Method | Route | Service method |
|---|---|---|
| GET | `/:service` | `find` |
| GET | `/:service/:id` | `get` |
| POST | `/:service` | `create` |
| PUT | `/:service/:id` | `update` |
| PATCH | `/:service/:id` | `patch` |
| DELETE | `/:service/:id` | `remove` |
| POST | `/:service/:method` | custom method |

#### Differences from `@mantlejs/express`

- `params.provider` is `'koa'`
- Body parsing uses Koa's `ctx.request.body` (requires `koa-body` or `koa-bodyparser`)
- Error handling uses Koa's `ctx.throw()` and `ctx.body`
- `@mantlejs/socketio` attaches to the underlying `http.Server` from Koa — must call `app.listen()` before `socketio()` or use `app.get('server')` after listen

#### Typical setup

```typescript
import { mantle } from '@mantlejs/mantle';
import { koa } from '@mantlejs/koa';

const app = mantle().configure(koa());
app.listen(3030);
```

---

### `@mantlejs/http`

Plain HTTP adapter targeting Node.js `http` module and the Fetch API `Request`/`Response` interface. Enables Mantle services in serverless and edge environments (AWS Lambda, Cloudflare Workers, Vercel Functions) where Express and Koa are unavailable or undesirable.

**Dependencies:** `@mantlejs/mantle` only. Zero framework dependencies.

```typescript
function http(options?: HttpOptions): MantlePlugin;

interface HttpOptions {
  /** Prefix for all service routes. Default: '' */
  prefix?: string;
}
```

#### Two dispatch modes

**Mode 1 — Node.js `http.Server`:**

```typescript
import { createServer } from 'node:http';
const app = mantle().configure(http());
const server = createServer(app.get('httpHandler'));
server.listen(3030);
```

**Mode 2 — Fetch API (edge/serverless):**

```typescript
// Cloudflare Worker / Vercel Edge Function
export default {
  fetch: app.get('fetchHandler'),
};
```

`app.get('httpHandler')` returns a `(req, res) => void` compatible with Node.js `http.createServer`.
`app.get('fetchHandler')` returns a `(request: Request) => Promise<Response>` compatible with the Fetch API.

`params.provider` is set to `'http'` for both modes. The hook pipeline runs identically.

---

### `@mantlejs/auth-facebook`

Facebook OAuth 2.0 strategy. Follows the same pattern as `@mantlejs/auth-google` and `@mantlejs/auth-github`.

**Dependencies:** `@mantlejs/mantle`, `@mantlejs/auth-oauth`

```typescript
function facebookStrategy(config: FacebookStrategyConfig): MantlePlugin;

interface FacebookStrategyConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl?: string;       // Default: '/auth/facebook/callback'
  scope?: string[];            // Default: ['email', 'public_profile']
  entity?: string;             // Default: 'users'
  entityIdField?: string;      // Default: 'facebookId'
}
```

#### Routes registered automatically

| Method | Route | Description |
|---|---|---|
| GET | `/auth/facebook` | Redirect to Facebook OAuth dialog |
| GET | `/auth/facebook/callback` | Handle callback, create/find user, issue Mantle JWT |

#### Auth flow

1. Redirect to `https://www.facebook.com/v18.0/dialog/oauth` with client ID, scope, and state
2. User approves; Facebook redirects to callback with `code`
3. Exchange code for Facebook access token (`graph.facebook.com/v18.0/oauth/access_token`)
4. Fetch profile from `graph.facebook.com/v18.0/me?fields=id,name,email`
5. Find-or-create user via `app.service(entity)`
6. Issue Mantle access + refresh tokens
7. Return `{ accessToken, refreshToken, user }`

---

### `@mantlejs/client`

Official JS/TS client SDK. Communicates with a Mantle application over REST (fetch) and real-time (socket.io-client). Designed for browsers, Node.js, and React Native.

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
```

#### Service client API

```typescript
interface MantleClient {
  service<T>(path: string): ServiceClient<T>;
  authenticate(credentials: AuthCredentials): Promise<AuthResult>;
  logout(): Promise<void>;
  getAccessToken(): string | undefined;
  on(event: 'authenticated' | 'logout', handler: () => void): this;
}

interface ServiceClient<T> {
  find(params?: ClientParams): Promise<T[] | Paginated<T>>;
  get(id: Id, params?: ClientParams): Promise<T>;
  create(data: Partial<T>, params?: ClientParams): Promise<T>;
  update(id: Id, data: Partial<T>, params?: ClientParams): Promise<T>;
  patch(id: Id, data: Partial<T>, params?: ClientParams): Promise<T>;
  remove(id: Id, params?: ClientParams): Promise<T>;
  on(event: 'created' | 'updated' | 'patched' | 'removed', handler: (data: T) => void): this;
  off(event: string, handler: (data: T) => void): this;
}
```

#### Transport routing

- Standard CRUD methods (`find`, `get`, `create`, `update`, `patch`, `remove`) use REST by default
- Real-time subscriptions (`on('created', ...)`) use socket.io-client when `socket` option is configured
- If `socket` is omitted, `ServiceClient.on()` throws `GeneralError` at call time (not at construction)

#### Authentication

```typescript
const client = mantle({ url: 'http://localhost:3030' });

// Local strategy
await client.authenticate({ strategy: 'local', email: 'user@example.com', password: 'secret' });

// Subsequent requests automatically include Authorization: Bearer <token>
const profile = await client.service<User>('users').get('me');
```

Token storage:
- Browser: `localStorage` by default (configurable to `sessionStorage` or custom)
- Node.js / React Native: in-memory by default (configurable to a custom `TokenStorage` implementation)

The access token is automatically attached to REST requests as `Authorization: Bearer <token>`. On 401 responses, the client attempts a token refresh using the stored refresh token before retrying once.

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

#### Error handling

Errors from the server are deserialized into typed `MantleError` instances. The client imports error classes from `@mantlejs/mantle` (optional peer) if available, or falls back to a plain object with the same shape.

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
function MantleProvider(props: { client: MantleClient; children: ReactNode }): JSX.Element;

// Hooks — mirror the Service<T> method names
function useFind<T>(service: string, params?: ClientParams, options?: UseQueryOptions<T[]>): UseQueryResult<T[]>;
function useGet<T>(service: string, id: Id, params?: ClientParams, options?: UseQueryOptions<T>): UseQueryResult<T>;
function useCreate<T>(service: string, options?: UseMutationOptions<T, Error, Partial<T>>): UseMutationResult<T, Error, Partial<T>>;
function useUpdate<T>(service: string, options?: UseMutationOptions<T, Error, { id: Id; data: Partial<T> }>): UseMutationResult;
function usePatch<T>(service: string, options?: UseMutationOptions<T, Error, { id: Id; data: Partial<T> }>): UseMutationResult;
function useRemove<T>(service: string, options?: UseMutationOptions<T, Error, Id>): UseMutationResult;
```

#### Real-time cache invalidation

When `@mantlejs/client` is configured with a socket and receives a service event, `@mantlejs/react` automatically calls `queryClient.invalidateQueries({ queryKey: [service] })`. This means:

- A REST `POST /messages` on the server → `messages created` event → React Query refetches `useFind('messages')` on all mounted components

No manual cache invalidation required. Opt-out per-query via `realtime: false` in options.

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

### `@mantlejs/mongodb`

MongoDB adapter implementing `Repository<T>`. Targets MongoDB 6.x and the official Node.js driver.

**Dependencies:** `@mantlejs/mantle`, `mongodb`

```typescript
function mongodb(options: MongoOptions): MantlePlugin;

interface MongoOptions {
  /** MongoDB connection URI */
  uri: string;
  /** Database name */
  database: string;
  /** MongoClient options passed to the driver */
  clientOptions?: MongoClientOptions;
}

class MongoRepository<T extends Record<string, unknown>> implements Repository<T> {
  readonly collectionName: string;  // override in subclass

  constructor(app: MantleApplication);

  // Full Repository<T> implementation
  findAll(params?: QueryParams): Promise<T[]>;
  findById(id: Id): Promise<T | null>;
  save(data: Partial<T>): Promise<T>;
  saveAll(data: Partial<T>[]): Promise<T[]>;
  updateById(id: Id, data: Partial<T>): Promise<T>;
  patchById(id: Id, data: Partial<T>): Promise<T>;
  deleteById(id: Id): Promise<T>;
  count(params?: QueryParams): Promise<number>;

  // MongoDB-specific
  withTransaction<R>(fn: (repo: this) => Promise<R>): Promise<R>;
  protected get collection(): Collection<T>;
}
```

#### QueryParams → MongoDB query mapping

| Mantle operator | MongoDB equivalent |
|---|---|
| `{ field: value }` | `{ field: value }` |
| `{ field: null }` | `{ field: null }` |
| `{ field: { $gt: v } }` | `{ field: { $gt: v } }` |
| `{ field: { $in: [...] } }` | `{ field: { $in: [...] } }` |
| `{ $or: [...] }` | `{ $or: [...] }` |
| `{ $and: [...] }` | `{ $and: [...] }` |
| `limit` | `.limit(n)` |
| `skip` | `.skip(n)` |
| `sort` | `.sort({ field: 1 | -1 })` |
| `select` | `.project({ field: 1 })` |

IDs: `findById` and `deleteById` accept string IDs and convert to `ObjectId` automatically when the ID is a valid ObjectId hex string.

---

### Vector database support — `VectorRepository<T>` interface

Added to `@mantlejs/mantle`. Extends `Repository<T>` with vector-specific operations.

```typescript
interface VectorRepository<T extends Record<string, unknown>> extends Repository<T> {
  /** Find the top-K records most similar to the given embedding vector */
  findSimilar(vector: number[], topK: number, params?: QueryParams): Promise<T[]>;
  /** Upsert a record with its embedding vector */
  upsertVector(id: Id, vector: number[], data: Partial<T>): Promise<T>;
  /** Delete a vector and its associated record */
  deleteVector(id: Id): Promise<T>;
}
```

Services that need semantic search declare `VectorRepository<T>` as their constructor dependency. Services that only do standard CRUD continue to use `Repository<T>`.

---

### `@mantlejs/pinecone`

Pinecone vector database adapter.

**Dependencies:** `@mantlejs/mantle`, `@pinecone-database/pinecone`

```typescript
function pinecone(options: PineconeOptions): MantlePlugin;

interface PineconeOptions {
  apiKey: string;
  /** Pinecone index name */
  index: string;
  /** Pinecone environment (for legacy regional deployments) */
  environment?: string;
}

class PineconeRepository<T extends Record<string, unknown>> implements VectorRepository<T> {
  readonly namespace: string;  // override in subclass — maps to Pinecone namespace

  findSimilar(vector: number[], topK: number, params?: QueryParams): Promise<T[]>;
  upsertVector(id: Id, vector: number[], data: Partial<T>): Promise<T>;
  deleteVector(id: Id): Promise<T>;

  // Base Repository<T> methods (wraps Pinecone metadata for non-vector CRUD)
  findAll(params?: QueryParams): Promise<T[]>;
  findById(id: Id): Promise<T | null>;
  save(data: Partial<T>): Promise<T>;
  // ... full Repository<T> implementation
}
```

Records are stored with their embedding vectors in Pinecone. Non-vector metadata is stored in Pinecone's metadata field. The `findAll` method filters via Pinecone's metadata filter API.

---

### `@mantlejs/qdrant`

Qdrant vector database adapter.

**Dependencies:** `@mantlejs/mantle`, `@qdrant/js-client-rest`

```typescript
function qdrant(options: QdrantOptions): MantlePlugin;

interface QdrantOptions {
  /** Qdrant server URL. Default: 'http://localhost:6333' */
  url?: string;
  /** API key for Qdrant Cloud */
  apiKey?: string;
  /** Vector size — must match the collection's configured dimension */
  vectorSize: number;
  /** Distance metric. Default: 'Cosine' */
  distance?: 'Cosine' | 'Dot' | 'Euclid';
}

class QdrantRepository<T extends Record<string, unknown>> implements VectorRepository<T> {
  readonly collectionName: string;  // override in subclass

  findSimilar(vector: number[], topK: number, params?: QueryParams): Promise<T[]>;
  upsertVector(id: Id, vector: number[], data: Partial<T>): Promise<T>;
  deleteVector(id: Id): Promise<T>;
  // ... full Repository<T> + VectorRepository<T> implementation
}
```

Qdrant's payload system stores all non-vector fields. Filtering via `QueryParams.where` maps to Qdrant's payload filter syntax.

---

### `@mantlejs/pgvector`

pgvector extension support added to `@mantlejs/knex`. Adds `findSimilar` to `KnexRepository` without a separate package — delivered as an extension to the existing Knex adapter.

**Dependencies:** Extends `@mantlejs/knex` — no new package required. Activates automatically when `pgvector` extension is detected.

```typescript
// Added to KnexRepository when using PostgreSQL + pgvector extension
interface KnexRepositoryWithVector<T> extends KnexRepository<T>, VectorRepository<T> {
  /** Column storing the vector. Override to change. Default: 'embedding' */
  readonly vectorColumn: string;

  findSimilar(vector: number[], topK: number, params?: QueryParams): Promise<T[]>;
  upsertVector(id: Id, vector: number[], data: Partial<T>): Promise<T>;
}
```

SQL generated for `findSimilar`:
```sql
SELECT *, embedding <=> $1 AS distance
FROM <table>
ORDER BY embedding <=> $1
LIMIT $2;
```

This is the most practical choice for teams already using PostgreSQL — no additional infrastructure, no new npm package.

---

### Graph database support — `GraphRepository<T>` interface

Added to `@mantlejs/mantle`. A separate interface from `Repository<T>` — graph traversal semantics are different enough that extension doesn't fit cleanly.

```typescript
interface GraphRepository<T extends Record<string, unknown>> {
  /** Create a node */
  createNode(data: Partial<T>): Promise<T>;
  /** Find a node by ID */
  findNodeById(id: Id): Promise<T | null>;
  /** Find nodes matching properties */
  findNodes(params?: QueryParams): Promise<T[]>;
  /** Create a directed relationship between two nodes */
  createRelationship(fromId: Id, toId: Id, type: string, properties?: Record<string, unknown>): Promise<void>;
  /** Traverse relationships from a starting node */
  traverse(startId: Id, relation: string, depth?: number): Promise<T[]>;
  /** Delete a node and all its relationships */
  deleteNode(id: Id): Promise<T>;
  /** Execute a raw Cypher query */
  cypher<R = T>(query: string, params?: Record<string, unknown>): Promise<R[]>;
}
```

Services backed by a graph repository declare `GraphRepository<T>` as their constructor dependency. The `cypher()` escape hatch handles complex traversals that don't fit the structured API.

---

### `@mantlejs/neo4j`

Neo4j graph database adapter.

**Dependencies:** `@mantlejs/mantle`, `neo4j-driver`

```typescript
function neo4j(options: Neo4jOptions): MantlePlugin;

interface Neo4jOptions {
  /** Neo4j Bolt URI. Default: 'bolt://localhost:7687' */
  uri?: string;
  /** Authentication */
  auth: { username: string; password: string };
  /** Neo4j database name. Default: 'neo4j' */
  database?: string;
}

class Neo4jRepository<T extends Record<string, unknown>> implements GraphRepository<T> {
  /** Node label in Neo4j. Override in subclass. */
  readonly label: string;

  createNode(data: Partial<T>): Promise<T>;
  findNodeById(id: Id): Promise<T | null>;
  findNodes(params?: QueryParams): Promise<T[]>;
  createRelationship(fromId: Id, toId: Id, type: string, properties?: Record<string, unknown>): Promise<void>;
  traverse(startId: Id, relation: string, depth?: number): Promise<T[]>;
  deleteNode(id: Id): Promise<T>;
  cypher<R = T>(query: string, params?: Record<string, unknown>): Promise<R[]>;
}
```

`findNodes` with `QueryParams.where` maps to `MATCH (n:Label) WHERE n.field = $value RETURN n`. `traverse` generates `MATCH (n:Label {id: $id})-[r:RELATION*1..$depth]->(m) RETURN m`.

---

### `@mantlejs/sync`

Cross-instance service event replication. Ensures a mutation on any instance triggers socket broadcasts on **all** instances, while preserving the channels security model.

**Dependencies:** `@mantlejs/mantle` (peer), `ioredis` (peer — for `redisAdapter`)

**Requires:** `@mantlejs/socketio` with channels configured (Phase 2).

#### How it works

Without sync, service events are scoped to the process that handled the mutation:

```
Instance A  REST POST /messages
              → Service.create() → app.emit('service:event', ...)
              → socketio broadcasts to Instance A clients only ✓
Instance B  clients connected here receive nothing ✗
```

With sync, the event is published to Redis and re-emitted on every other instance:

```
Instance A  REST POST /messages
              → app.emit('service:event', ...) → local broadcast ✓
              → sync publishes to Redis

Redis → Instance B: re-emits locally → channels → broadcast ✓
Redis → Instance C: re-emits locally → channels → broadcast ✓
Redis → Instance A: originId matches → skip (already sent) ✓
```

Channel filtering (tenant scoping, permission checks) runs locally on each receiving instance — the broker carries raw event data only.

#### `sync()` plugin factory

```typescript
function sync(options: SyncOptions): MantlePlugin;

interface SyncOptions {
  adapter: SyncAdapter;
  /** Filter which services are synced. Default: all */
  services?: string[];
}

interface SyncAdapter {
  publish(channel: string, message: SyncMessage): Promise<void>;
  subscribe(channel: string, handler: (message: SyncMessage) => void): Promise<void>;
  close(): Promise<void>;
}

interface SyncMessage {
  originId: string;   // UUID of originating instance — used for deduplication
  path: string;
  event: string;
  result: unknown;
  params: Record<string, unknown>;
}
```

#### `redisAdapter()` — built-in Redis adapter

```typescript
function redisAdapter(options: RedisAdapterOptions): SyncAdapter;

interface RedisAdapterOptions {
  url?: string;         // Default: 'redis://localhost:6379'
  host?: string;
  port?: number;        // Default: 6379
  password?: string;
  prefix?: string;      // Pub/sub channel prefix. Default: 'mantle:sync'
}
```

Uses `ioredis` for pub/sub (two connections — required by Redis pub/sub protocol). Sync failures are non-fatal: local clients are not affected and a warning is logged.

#### Typical setup

```typescript
import { sync, redisAdapter } from '@mantlejs/sync';

const app = mantle()
  .configure(express())
  .configure(socketio())
  .configure(sync({ adapter: redisAdapter({ url: process.env.REDIS_URL }) }));

app.service('messages').publish((data, ctx) => app.channel('authenticated'));
app.listen(3030);
```

---

## Package Structure Additions

```text
mantle/
├── packages/
│   ├── [all Phase 1 + Phase 2 packages — core renamed to mantle/]
│   ├── koa/             @mantlejs/koa          [NEW P3]
│   ├── http/            @mantlejs/http         [NEW P3]
│   ├── auth-facebook/   @mantlejs/auth-facebook [NEW P3]
│   ├── client/          @mantlejs/client       [NEW P3]
│   ├── react/           @mantlejs/react        [NEW P3]
│   ├── mongodb/         @mantlejs/mongodb      [NEW P3]
│   ├── pinecone/        @mantlejs/pinecone     [NEW P3]
│   ├── qdrant/          @mantlejs/qdrant       [NEW P3]
│   ├── neo4j/           @mantlejs/neo4j        [NEW P3]
│   ├── sync/            @mantlejs/sync         [NEW P3]
│   └── create-mantle/   create-mantle          [NEW P3 — unscoped]
```

Note: `@mantlejs/pgvector` is delivered as an extension to `@mantlejs/knex`, not a separate package.

### Updated Package Dependency Rules (Phase 3 additions)

| Package | May depend on |
|---|---|
| `create-mantle` | `@mantlejs/cli` |
| `@mantlejs/koa` | `@mantlejs/mantle` |
| `@mantlejs/http` | `@mantlejs/mantle` |
| `@mantlejs/auth-facebook` | `@mantlejs/mantle`, `@mantlejs/auth-oauth` |
| `@mantlejs/client` | nothing (types-only optional peer on `@mantlejs/mantle`) |
| `@mantlejs/react` | `@mantlejs/client` |
| `@mantlejs/mongodb` | `@mantlejs/mantle` |
| `@mantlejs/pinecone` | `@mantlejs/mantle` |
| `@mantlejs/qdrant` | `@mantlejs/mantle` |
| `@mantlejs/neo4j` | `@mantlejs/mantle` |
| `@mantlejs/sync` | `@mantlejs/mantle` |
| `@mantlejs/knex` (pgvector ext) | `@mantlejs/mantle` (unchanged) |

`@mantlejs/sync` must NOT depend on `@mantlejs/socketio`. It operates at the `'service:event'` bus level and is transport-agnostic.

---

## Developer Experience Principles

Phase 3 upholds all Phase 1 and Phase 2 principles and adds:

**10. Zero-Friction Start** — `npm create mantle my-api` requires no global install and no prior knowledge of the package ecosystem. A developer with Node.js installed can have a running Mantle API in under two minutes.

**11. Add Without Rewiring** — `mantle add @mantlejs/socketio` installs the package and modifies `app.ts` automatically. Adding a new capability to an existing application is a one-command operation.

**12. Scale Transparently** — Adding `@mantlejs/sync` is a single `.configure()` call. No changes to services, hooks, repositories, or channel publishers are required.

**13. Consistent Client API** — `@mantlejs/client` exposes the same `find`, `get`, `create`, `update`, `patch`, `remove` method names developers know from the server. Switching between server-side and client-side service calls is minimal context switching.

**14. AI-Agent Ready** — Vector and graph database adapters make Mantle a natural fit for AI-powered applications. `VectorRepository<T>` enables semantic search as a first-class service concern. `GraphRepository<T>` enables knowledge graph traversal. Both integrate with the hook pipeline, authentication, and real-time events with no special casing.

---

## Success Metrics

| Metric | Phase 3 Target |
|---|---|
| `npm create mantle` → first running API | < 2 minutes on a fresh machine |
| `mantle add` success rate | Correctly modifies `app.ts` for all documented packages |
| Cross-instance event delivery | < 10ms additional latency vs local delivery (Redis RTT) |
| Sync failure isolation | Redis outage does not affect REST response times or local socket delivery |
| Client bundle size | < 20KB gzipped (excluding socket.io-client) |
| React hooks | Real-time cache invalidation fires within 100ms of a server mutation |
| Vector search | `findSimilar` returns top-K results with correct cosine ranking |

---

## Architectural & Design Decisions

| # | Question | Decision |
|---|---|---|
| 1 | `create-mantle` vs `@mantlejs/create-mantle`? | **Unscoped `create-mantle`** — `npm create mantle` requires the package be named `create-mantle` (npm's create convention). `@mantlejs/create-mantle` would require `npm create @mantlejs/mantle` which is awkward. |
| 2 | `mantle add` — regex vs AST? | **TypeScript compiler API (AST)**. Regex-based `app.ts` modification is brittle; AST manipulation handles formatting variations, comments, and multi-line chains reliably. |
| 3 | One `@mantlejs/client` or split REST + Socket.io? | **One package.** Socket.io-client is an optional peer dependency — tree-shaken when unused. A unified client gives better UX (one install, one API surface) and matches `@feathersjs/client`. |
| 4 | React hooks — React Query vs roll-our-own? | **TanStack Query (React Query v5).** Rolling our own means reimplementing caching, background refetch, stale-while-revalidate, and optimistic updates poorly. TanStack Query is the de facto standard; Socket.io events map cleanly to `queryClient.invalidateQueries()`. |
| 5 | MongoDB driver — native vs Mongoose? | **Native `mongodb` driver** — same choice as FeathersJS. Mongoose schema enforcement conflicts with the TypeBox schema system already in `@mantlejs/schema`. Repository pattern handles all transformation without an ODM. |
| 6 | Vector DB selection? | **Pinecone** (most used in production LLM apps), **Qdrant** (best open-source self-hosted option), **pgvector** (zero new infrastructure for PostgreSQL users — delivered as a `@mantlejs/knex` extension). |
| 7 | Graph DB selection? | **Neo4j** — the standard, best Node.js ecosystem, Cypher is widely known. Neptune/ArangoDB are Phase 4 multi-cloud additions. |
| 8 | `VectorRepository<T>` in core? | **Yes — in `@mantlejs/mantle`.** The interface is infrastructure-free (no driver imports). Defining it in core ensures all vector adapters are interchangeable and services remain transport-agnostic. |
| 9 | `GraphRepository<T>` extends `Repository<T>`? | **No — separate interface.** Graph traversal semantics (`traverse`, `cypher`) are fundamentally different from record-by-ID CRUD. Forcing them into `Repository<T>` would produce an awkward interface with many irrelevant methods. |
| 10 | `@mantlejs/http` — Node.js http vs Fetch API? | **Both modes** — `httpHandler` for Node.js `http.createServer`, `fetchHandler` for Fetch API (Cloudflare Workers, Vercel Edge). The same Mantle routing logic powers both; the adapter detects the call style. |
| 11 | Where does sync channel filtering run? | **Locally on each receiving instance.** The broker carries raw event data only. Each instance runs its own channel publishers before broadcasting — per-user filtering and permission checks are never bypassed by the sync layer. |
| 12 | pgvector — separate package or knex extension? | **Knex extension** (`@mantlejs/knex` gains `VectorRepository<T>` support). No new package or install step for PostgreSQL users — just enable the pgvector extension in their database and use `findSimilar`. |
