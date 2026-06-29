# Mantle JS — Phase 3 Implementation Checklist

Work through these in order. Each item maps to a package spec in the Phase 3 PRD.

---

- [x] **1. Add `VectorRepository<T>` and `GraphRepository<T>` to `@mantlejs/mantle`**
  Add two new interface extensions to the public API of `@mantlejs/mantle`. `VectorRepository<T>` extends `Repository<T>` with `findSimilar(vector, topK, params?)`, `upsertVector(id, vector, data)`, and `deleteVector(id)`. `GraphRepository<T>` is a standalone interface (does NOT extend `Repository<T>`) with `createNode`, `findNodeById`, `findNodes`, `createRelationship`, `traverse`, `deleteNode`, and `cypher`. No implementation ships in `@mantlejs/mantle` — zero new dependencies. Export both interfaces from `src/index.ts`.

- [x] **2. Implement `create-mantle`**
  New unscoped package (`create-mantle`, not `@mantlejs/create-mantle`) published to npm so `npm create mantle my-api` resolves correctly. The package is a minimal bin entry point that imports `newProject()` from `@mantlejs/cli` and forwards `process.argv` to it. No template logic is duplicated — all scaffolding lives in `@mantlejs/cli`. The `bin` field points to `dist/bin/create-mantle.js`. Add `create-mantle` to the packages table in the root `README.md`.

- [x] **3. Implement `@mantlejs/cli` — Phase 3 additions**
  Three additions to the existing CLI binary:
  - **`mantle add <package>`**: Detects the package manager from the lockfile (npm/yarn/pnpm), runs install, then modifies `src/app.ts` using the TypeScript compiler API (AST manipulation — no regex). Inserts the import declaration and appends `.configure(plugin(options))` to the `mantle()` call chain. Ships wiring templates for: `@mantlejs/logger`, `@mantlejs/socketio`, `@mantlejs/koa`, `@mantlejs/auth`, `@mantlejs/auth-local`, `@mantlejs/auth-google`, `@mantlejs/auth-github`, `@mantlejs/auth-facebook`, `@mantlejs/sync`, `@mantlejs/config`. Unknown packages print instructions without modifying the file.
  - **`mantle generate authentication` (alias `g auth`)**: Generates `src/authentication.ts` with detected strategy configuration (reads installed `@mantlejs/auth-*` packages). Prints instructions for wiring into `app.ts`.
  - **`mantle generate migration <name>` (alias `g migration`)**: Requires `@mantlejs/knex`. Writes `migrations/<timestamp>_<name>.ts` following Knex migration conventions with `up` and `down` stubs.

- [x] **4. Implement `@mantlejs/koa`**
  New package. `koa()` plugin factory registers service routes on a Koa application using `@koa/router`. Set `params.provider = 'koa'`. Register the same six REST route patterns as `@mantlejs/express`: `GET /:service`, `GET /:service/:id`, `POST /:service`, `PUT /:service/:id`, `PATCH /:service/:id`, `DELETE /:service/:id`, `POST /:service/:method` (custom methods). Error handler maps `MantleError` subclasses to correct HTTP status codes. Store the underlying Koa app as `app.set('koa', koaApp)` and the http.Server as `app.set('server', server)` after `app.listen()`. `@mantlejs/socketio` must be able to attach to `app.get('server')`.

- [x] **5. Implement `@mantlejs/http`**
  New package. `http()` plugin factory sets two handlers on the app: `app.get('httpHandler')` returns a Node.js `(req: IncomingMessage, res: ServerResponse) => void` handler compatible with `http.createServer`; `app.get('fetchHandler')` returns a `(request: Request) => Promise<Response>` handler compatible with the Fetch API (Cloudflare Workers, Vercel Edge Functions, AWS Lambda@Edge). Both modes run the full Mantle hook pipeline. Set `params.provider = 'http'`. Zero framework dependencies — only `@mantlejs/mantle` and Node.js built-ins. Route matching and body parsing are implemented from scratch (no Express/Koa).

- [x] **6. Implement `@mantlejs/auth-facebook`**
  New package. `facebookStrategy()` plugin. Registers `GET /auth/facebook` (redirect to `facebook.com/v18.0/dialog/oauth`) and `GET /auth/facebook/callback` (code exchange, profile fetch via `graph.facebook.com/v18.0/me?fields=id,name,email`, find-or-create user, issue Mantle JWT). Follows the exact same pattern as `@mantlejs/auth-google`. Default scope: `['email', 'public_profile']`. Default `entityIdField`: `'facebookId'`. Returns `{ accessToken, refreshToken, user }`.

- [x] **7. Implement `@mantlejs/dynamodb`**
  New package. `dynamodb()` plugin factory initializes the AWS DynamoDB client (using `@aws-sdk/lib-dynamodb`) and stores it as `app.set('dynamodb', client)`. `DynamoRepository<T>` implements the full `Repository<T>` interface. Subclasses declare `readonly tableName: string`, optionally `readonly pk: string` (default: `'id'`), and `readonly sk?: string` (sort key for composite-key tables). `findById` uses `GetItem`. `findAll` uses `Scan` with `FilterExpression` built from `QueryParams.where` operators: equality (`=`), comparison (`<`, `<=`, `>`, `>=`), not-equal (`<>`), `$in` (multiple `OR` conditions), `$like` → `contains()`; `$or`/`$and` map to `OR`/`AND` in `FilterExpression`. `limit` maps to DynamoDB's `Limit`; `skip` is not supported — cursor pagination is exposed via `params.query._startKey` (`LastEvaluatedKey`). `sort` without a sort key is done in memory with a warning. `save` uses `PutItem`. `updateById` and `patchById` use `UpdateItem` with a generated `UpdateExpression`. `withTransaction(fn)` uses `TransactWriteItems` (100-item limit). `endpoint` option supports DynamoDB Local / LocalStack. Auto UUID via `crypto.randomUUID()`, auto timestamps (`createdAt`, `updatedAt`).

- [x] **8. Implement `@mantlejs/supabase`**
  New package with two concerns. **(1) `SupabaseRepository<T>`** implements the full `Repository<T>` interface using the `@supabase/supabase-js` client's table API. Subclasses declare `readonly tableName: string`. `QueryParams.where` operators map to Supabase's builder methods: `.eq()`, `.neq()`, `.gt()`, `.gte()`, `.lt()`, `.lte()`, `.in()`, `.or()`, `.like()`, `.ilike()`, `.is()` (null). `limit`/`skip` map to `.range()`; `sort` maps to `.order()`. **(2) `supabaseAdapter()`** — a `SyncAdapter` for `@mantlejs/sync` that uses **Supabase Realtime Broadcast** channels as the pub/sub transport in place of Redis. Teams already using Supabase get cross-instance event replication with zero additional infrastructure. Optionally, set `listenToChanges = true` on a `SupabaseRepository<T>` subclass to subscribe to **Postgres Changes** (WAL-based) — direct database mutations from PostgREST, migrations, Supabase Studio, or other clients are translated to Mantle `service:event` emissions and fan out through the channels system on all connected instances.

- [x] **9. Implement pgvector extension for `@mantlejs/knex`**
  Extend `KnexRepository<T>` (no new package) with `VectorRepository<T>` support for PostgreSQL + pgvector. Add a `vectorColumn` property (default: `'embedding'`) and implement `findSimilar(vector, topK, params?)`, `upsertVector(id, vector, data)`, and `deleteVector(id)`. `findSimilar` generates: `SELECT *, embedding <=> $1 AS _distance FROM <table> ORDER BY embedding <=> $1 LIMIT $2`. Cosine distance operator (`<=>`) is the default; expose `distanceOperator` property for `<#>` (negative inner product) and `<->` (L2). Only activate on `pg` client — throw `GeneralError` if called on non-PostgreSQL connections.

- [ ] **10. Implement `@mantlejs/pinecone`**
  New package. `pinecone()` plugin factory initializes the Pinecone client (using `@pinecone-database/pinecone`) and stores it as `app.set('pinecone', client)`. `PineconeRepository<T>` implements `VectorRepository<T>`. Subclasses declare `readonly namespace: string`. Records are stored with their vectors in Pinecone; non-vector metadata is stored in Pinecone's metadata field. `findAll` / `findNodes` filter via Pinecone's metadata filter API mapped from `QueryParams.where`. `findById` uses `index.fetch([id])`. `save` uses `index.upsert()` with a zero vector (for records not yet assigned an embedding — set via `upsertVector`).

- [ ] **11. Implement `@mantlejs/qdrant`**
  New package. `qdrant()` plugin factory initializes the Qdrant client (using `@qdrant/js-client-rest`) and stores it as `app.set('qdrant', client)`. `QdrantRepository<T>` implements `VectorRepository<T>`. Subclasses declare `readonly collectionName: string`. Constructor option `vectorSize: number` is required (must match collection dimension). `findSimilar` uses Qdrant's `search` endpoint. `findAll` uses `scroll` with payload filtering. `QueryParams.where` maps to Qdrant payload filter syntax. `upsertVector` uses `upsert` with named vector `'default'`. Auto-create collection on first write if it does not exist.

- [ ] **12. Implement `@mantlejs/neo4j`**
  New package. `neo4j()` plugin factory opens a Neo4j driver connection (using `neo4j-driver`) and stores it as `app.set('neo4j', driver)`. `Neo4jRepository<T>` implements `GraphRepository<T>`. Subclasses declare `readonly label: string` (the Neo4j node label). Implement all `GraphRepository<T>` methods: `createNode` (`CREATE (n:Label $props) RETURN n`), `findNodeById` (`MATCH (n:Label {id: $id}) RETURN n`), `findNodes` (mapped from `QueryParams.where`), `createRelationship` (`MATCH (a), (b) WHERE a.id = $from AND b.id = $to CREATE (a)-[r:TYPE $props]->(b)`), `traverse` (`MATCH (n)-[r:TYPE*1..$depth]->(m) RETURN m`), `deleteNode` (`DETACH DELETE`), `cypher` (raw query passthrough). Auto-close session after each operation. Support transactions via `withTransaction(fn)` using Neo4j sessions.

- [ ] **13. Implement `@mantlejs/sync`**
  New package. `sync()` plugin intercepts `'service:event'` emissions on the Mantle application event bus, publishes them to a shared message broker (via pluggable `SyncAdapter`), and re-emits received messages from other instances locally — where `@mantlejs/socketio` picks them up and fans out through the channels system. Ship two built-in adapters: `redisAdapter()` using `ioredis` (peer dep, two connections for pub/sub) — also compatible with **DragonflyDB** (a Redis-compatible in-memory store with higher throughput; drop-in replacement, same pub/sub protocol); and `supabaseAdapter()` from `@mantlejs/supabase` (uses Supabase Realtime Broadcast — zero additional infrastructure for Supabase users). Each plugin instance generates a UUID (`instanceId`) at startup; received messages with matching `originId` are dropped (local clients already received the event directly). Sync failures are non-fatal: log a warning via `app.get('logger')`, do not throw. Must NOT import from `@mantlejs/socketio` — operates at the `'service:event'` bus level only.

---

## Reference

- [Phase 3 PRD](./mantle-js-phase-3-prd.md)
- [Phase 4 Checklist](./mantle-js-phase-4-checklist.md) — `@mantlejs/client` and `@mantlejs/react`
- [Phase 2 PRD](./mantle-js-phase-2-prd.md)
- [Phase 2 Checklist](./mantle-js-phase-2-checklist.md)
- [Phase 1 PRD](./mantle-js-phase-1-prd.md)
