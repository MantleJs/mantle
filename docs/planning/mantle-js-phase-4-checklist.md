# Mantle JS — Phase 4 Implementation Checklist

Work through these in order. Each item maps to a package spec in the Phase 4 PRD.

> **Prerequisites:** the [AI-First Review Remediation Checklist](./ai-first-review-checklist.md) Tier A items
> (security/correctness fixes) must land before item 8 (npm release), and its Tier B items block work here:
> B-1 (refresh-token service) blocks item 1 — the client's `POST /authentication/refresh` retry targets an endpoint
> that does not exist yet — and B-2 (`RepositoryService<T>`) blocks items 1 and 4, which need canonical query
> semantics and a stable `Paginated<T>` shape to build against.

---

- [x] **1. Implement `@mantlejs/client`**
      _(Done. Per the phase-4 TDD decision there is no `/authentication/refresh` alias — the 401 retry rotates via
      `POST /authentication` with `{ strategy: "refresh", refreshToken }`, single-flighted across concurrent 401s so
      rotation's reuse detection can't trip. Fold-ins landed here: C-8's client half (`'reconnect'` client event on
      socket re-connects) and D-4's remainder (`ServiceClient.similar()` posting to `/:service/similar`). Query
      serialization is specced as a round-trip against `parseQueryString` from `@mantlejs/mantle` (dev-only dep).
      Real-time uses an injectable socket factory (`SocketOptions.io`) over the optional `socket.io-client` peer,
      which is dynamically imported on first `.on()`.)_
      New package. `mantle(options)` factory returns a `MantleClient`. Implements the full `Service<T>` method surface (`find`, `get`, `create`, `update`, `patch`, `remove`) as REST calls via native `fetch` (Node.js 18+, browser, React Native). `ClientParams.query` is serialized as URL query parameters. Real-time subscriptions (`ServiceClient.on('created', handler)`) use `socket.io-client` (optional peer dependency) when `socket` option is configured; throw `GeneralError` at call time if socket is not configured — socket connects lazily on the first `.on()` call. Handle authentication: `client.authenticate({ strategy, ...credentials })` calls `POST /authentication`, stores `accessToken` + `refreshToken` in the configured `TokenStorage` (default: `localStorage` in browser, in-memory in Node.js). Automatically attach `Authorization: Bearer <token>` to every REST request. On 401, attempt one token refresh via `POST /authentication/refresh` before retrying; on refresh failure emit `'logout'` and throw `NotAuthenticated`. Deserialize non-2xx responses into typed `MantleClientError` objects (`name`, `message`, `code`, `data`, `errors`). Export `mantle`, `MantleClient`, `ServiceClient`, `ClientOptions`, `TokenStorage`, `MantleClientError`.

- [x] **2. Implement `@mantlejs/react`**
      _(Done. C-8's remainder folded in: `MantleProvider` listens for the client's `'reconnect'` event and calls
      `queryClient.invalidateQueries()` (no filter) to bound staleness from missed events. Reference counting lives in
      the react package (a per-service `RealtimeRegistry` held by the provider) — one listener set per service, detached
      when the last hook unmounts — layered over the client's own per-event multiplexer. Socket detection needed a small
      additive change to `@mantlejs/client`: a public `ServiceClient.realtime` getter (`on()`/`off()` throw when no
      socket is configured, so the hooks check first). One deviation from the phase-4 TDD: `useFind` is typed
      `UseQueryResult<T[] | Paginated<T>>` — the TDD's `UseQueryResult<T[]>` predates B-2's decision that
      `RepositoryService.find()` always returns a `Paginated<T>` envelope, and the client SDK types `find()` as the
      union.)_
      New package. React hooks for Mantle services built on TanStack Query v5. Export `MantleProvider` (wraps `QueryClientProvider`, creates a default `QueryClient` if none provided, stores `MantleClient` in context), `useMantleClient`, `useFind`, `useGet`, `useCreate`, `useUpdate`, `usePatch`, `useRemove`. `useFind` and `useGet` wrap `useQuery` with keys `[service, 'find', params]` and `[service, 'get', id, params]`. Mutation hooks wrap `useMutation`. When the client has a socket configured, `useFind` and `useGet` register socket event listeners on mount (one set per `(client, service)` pair, reference-counted) that call `queryClient.invalidateQueries({ queryKey: [service] })` on `created`, `updated`, `patched`, and `removed` events. Opt-out per hook via `realtime: false` in options. Listeners are cleaned up when the last hook for a service unmounts. Export `MantleProviderProps`, `MantleQueryOptions`.

- [x] **3. Implement `@mantlejs/mongodb`**
      New package. `mongodb(options)` configure plugin opens one `MongoClient` (Atlas or self-hosted, replica-set required for transactions), stores it on `app`. `MongoRepository<T, D>` abstract class implements `Repository<T, D>` over the official `mongodb` driver (no Mongoose). Translate `QueryParams` operators directly to MongoDB filter syntax (`$lt`/`$lte`/`$gt`/`$gte`/`$in`/`$nin`/`$or`/`$and`/`$ne` map 1:1); `$like`/`$ilike`/`$notlike` throw `BadRequest` (not supported — use the raw `collection` escape hatch with `$regex` instead). Convert `Id` ↔ `ObjectId` at the repository boundary — callers only ever see string ids. Implement `withTransaction()` via `client.startSession().withTransaction()`. Export `mongodb`, `MongoRepository`, `MongoConfig`.
      _(Shipped beyond the plan: `$contains` + dot-path support passing the shared `NESTED_QUERY_CASES` conformance fixture, and `MongoVectorRepository<T, D>` implementing `VectorRepository<T>` via MongoDB Atlas Vector Search — `findSimilar` runs a `$vectorSearch` aggregation against a configurable Atlas index (`vectorIndexName`/`vectorField`/`candidateMultiplier`), compatible with `VectorRepositoryService`'s `POST /<path>/similar`.)_

- [x] **4. Implement `@mantlejs/openapi`**
      New package. `openapi(options)` configure plugin walks `app`'s registered services, reads each `ServiceHandle.methods`, detects `@mantlejs/schema` `validate()` hooks (via the schema attached for introspection) to populate request/response schemas, and detects `authenticate('jwt')` in `before.all` to mark paths as requiring `bearerAuth`. Assembles an OpenAPI 3.1 document (`paths`, `components.schemas`, `components.securitySchemes`) and serves it at `options.specPath` (default `/openapi.json`); optionally mounts a Swagger UI page at `options.docsPath`. Services without a detected schema still appear in the spec with a generic `object` schema — never skip or error for missing schema coverage. Export `openapi`, `OpenApiOptions`.

- [x] **5. Implement batch requests — server + client**
  - **Server:** add `app.batch(calls: BatchCall[])` to `@mantlejs/mantle` core — dispatches each call through `app.service(call.service)[call.method](...)` (full hook pipeline, no auth/validation bypass) via `Promise.allSettled`, returns `BatchResult[]` in input order. Reject requests over `maxBatchSize` (default 25) with `BadRequest` before executing any call. Wire a `POST /batch` route in `@mantlejs/express`, `@mantlejs/koa`, and `@mantlejs/http`.
  - **Client:** add `ClientOptions.batch?: boolean | { windowMs?: number; maxSize?: number }` to `@mantlejs/client`. When enabled, service method calls enqueue into a `BatchScheduler` that flushes on a microtask (or `windowMs`) boundary as a single `POST /batch` request; each caller's promise resolves/rejects independently from the batched response. Queues longer than `maxSize` split into multiple requests.
        _(Shipped details: the transports mount the route by default with a `batch?: boolean | { path?, maxSize? }` option (`false` disables); malformed batch entries become per-call `BadRequest` error entries rather than failing the batch; client calls carrying per-request `headers` bypass coalescing and go out individually; per-entry 401 failures get the client's usual single refresh-then-retry so coalescing stays transparent under token rotation.)_

- [ ] **6. Add CORS support to `@mantlejs/express`, `@mantlejs/koa`, `@mantlejs/http`**
      Add a `cors?: boolean | CorsOptions` option to each transport's configure function. `@mantlejs/express` wraps the `cors` npm package; `@mantlejs/koa` wraps `@koa/cors`; `@mantlejs/http` hand-rolls header-setting and `OPTIONS` preflight short-circuiting. `cors: true` resolves to `{ origin: true, methods: [...CRUD verbs], credentials: false }`. Disabled (no CORS headers) by default across all three transports.

- [ ] **7. Extend `@mantlejs/storage` `StorageAdapter` with read/delete**
      Add `retrieve(key): Promise<Readable>`, `delete(key): Promise<void>`, and optional `getSignedUrl(key, options?): Promise<string>` to the `StorageAdapter` interface. Add `key: string` to `UploadedFile` (distinct from the existing `path`, which stays a display-oriented URL). Implement across all three backends: disk (`createReadStream`/`unlink` relative to `destination`), S3 (`GetObjectCommand`/`DeleteObjectCommand`/`@aws-sdk/s3-request-presigner`), GCS (`bucket.file(key)` stream/delete/`getSignedUrl`). Disk storage omits `getSignedUrl` entirely — no direct-download concept for local disk.

- [ ] **8. First npm release — curated package set**
      Prepare and publish packages (Phase 1–4) to the public npm registry in two tiers. Steps:
  - Verify all packages build, test, and lint cleanly: `npx nx run-many -t build,test,lint`
  - Confirm every `package.json` has `"publishConfig": { "access": "public" }`, correct `"exports"`, `"main"`, `"module"`, `"types"`, and `"files": ["dist"]` fields
  - **Finalize the publish-tier list** — re-confirm the [Publish Tiering](./mantle-js-phase-4-prd.md#publish-tiering) split (stable `0.1.0` vs `0.1.0-experimental`) against actual test coverage and any real-world usage at release time; the planning-time split is a starting point, not a final answer. This needs a dedicated discussion before publishing, not a rubber stamp of the draft list.
  - Set `version: "0.1.0"` (stable tier) or `"0.1.0-experimental"` (experimental tier) consistently; align `peerDependencies` ranges
  - Verify all README files are complete (at minimum: installation, quick start, API reference)
  - Publish in dependency order: `@mantlejs/mantle` → adapters/transports (including `@mantlejs/mongodb`) → `@mantlejs/auth*` → `@mantlejs/storage*` → `@mantlejs/sync` → `@mantlejs/openapi` → `@mantlejs/client` → `@mantlejs/react`
  - Confirm each package is resolvable: `npm install @mantlejs/<name>` succeeds from an empty project

---

## Reference

- [Phase 4 PRD](./mantle-js-phase-4-prd.md)
- [Phase 4 TDD](./mantle-js-phase4-tdd.md)
- [Phase 3 PRD](./mantle-js-phase-3-prd.md)
- [Phase 3 Checklist](./mantle-js-phase-3-checklist.md)
