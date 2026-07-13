# Mantle JS — AI-First Architecture Review

**Status:** Review — input to Phase 4/5 planning
**Date:** 2026-07-05
**Scope:** QueryParams across polyglot persistence · Auth architecture (vs. Arctic / Better Auth) · Real-time events (channels + cross-instance sync) · Phase 4/5 roadmap gaps · AI-first API design
**Method:** Full source read of `@mantlejs/mantle` core contracts, all six DB adapters, the auth package family, `@mantlejs/socketio`/`@mantlejs/sync`, and existing phase 4 planning docs. Every finding cites the file it is grounded in.

---

## 1. Executive summary

The fourteen highest-impact findings, in priority order:

1. **There is no framework-owned translation from `ServiceParams.query` to `QueryParams`.** HTTP query values arrive as raw strings (`packages/express/src/lib/routes.ts:8`) and every user-written service hand-rolls coercion and forwarding. This is the single largest correctness, security, and AI-usability gap in the framework.
2. **Where-operator behavior silently diverges across adapters.** The same `$like` query is dropped by Pinecone, reinterpreted as `contains()` by DynamoDB, full-text-matched by Qdrant, and executed literally by Knex. Unknown operators silently fall back to equality in Knex and DynamoDB. Same query, four different result sets, zero errors.
3. **Confirmed bug:** `dynamodbify.ts:85` emits a filter expression referencing a `:null_…` value alias that is never registered — any `{ field: null }` where clause against DynamoDB fails at runtime.
4. **No runtime introspection.** `ServiceOptions.schema` is stored but unused (`packages/mantle/src/lib/types.ts:130-131`); an agent (or the planned OpenAPI generator) cannot discover a service's fields, supported operators, or capabilities without trial and error.
5. **Cypher injection surface in Neo4j sort.** `findNodes` string-interpolates sort field names into Cypher (`packages/neo4j/src/lib/neo4j-repository.ts:123`), and sort keys can originate from user HTTP query input.
6. **OAuth strategies are hard-coupled to Express** (`packages/auth-oauth/src/lib/create-oauth-plugin.ts:38-41`), contradicting the transport-agnostic architecture — Koa and http transport users cannot use any OAuth provider package.
7. **OAuth state store is in-memory** (`packages/auth-oauth/src/lib/state-store.ts`), which breaks on the documented deployment target (Cloud Run, scale-to-zero, multiple instances).
8. **Refresh tokens are issued but not managed.** `create-oauth-plugin.ts:106` mints a second JWT with `type: "refresh"` but there is no refresh endpoint, no rotation, no revocation, and no server-side storage. The Phase 4 client spec assumes `POST /authentication/refresh` exists — it doesn't.
9. **Auth recommendation: keep the engine, adopt Arctic inside the OAuth layer, do not adopt Better Auth.** Detailed reasoning in §3.
10. **`Paginated<T> | T[]` union on `find()`** (`types.ts:56`) forces every caller — human or agent — to runtime-sniff the result shape. Pick one (paginated envelope) and standardize.
11. **`@mantlejs/sync` publishes raw bearer tokens to the message broker.** Every `service:event` is forwarded to Redis with the full `ctx.params` — including `headers.authorization` (the caller's JWT) and `params.user` — serialized verbatim (`packages/sync/src/lib/sync.ts:51-62`). Sanitize params before publishing.
12. **`ServiceParams.rooms` is documented in core but implemented nowhere** (`types.ts:42-43` promises room-scoped broadcast; `packages/socketio/src/lib/socketio.ts` never reads it) — a phantom API that misleads both developers and any LLM reading the types.
13. **Path traversal in the default disk-storage filename.** `diskStorage` joins the client-controlled `originalname` into the destination path unsanitized (`packages/storage/src/lib/disk-storage.ts:14-15`) — a filename containing `../` segments writes outside the upload directory.
14. **Operator queries only work over the Express transport.** `@mantlejs/http` flattens the query string via `URLSearchParams` (`packages/http/src/lib/http.ts:51,77`), so `?age[$gt]=21` arrives as the literal key `"age[$gt]"`; Koa's default parser is also flat (`packages/koa/src/lib/routes.ts:9`); only Express (qs) yields the nested `{ age: { $gt: "21" } }` the adapters expect. The same request means three different things across the three HTTP transports.

---

## 2. QueryParams across polyglot persistence

### 2.1 What exists today

`QueryParams` (`packages/mantle/src/lib/types.ts:47-53`) is a flat SQL-shaped contract: `where`, `limit`, `skip`, `sort`, `select`. Core already defines two non-relational contracts — `VectorRepository<T>` (`types.ts:75-82`) and `GraphRepository<T>` (`types.ts:84-99`) — which is the right architectural move: **specialized repository interfaces per data model, not a universal query language.** The gaps are in consistency, capability signaling, and reachability, not in the fundamental design.

### 2.2 Per-backend assessment

**SQL (Knex)** — the reference implementation. `knexify.ts` covers the full documented operator set. Two gaps:

- `knexify.ts:98-99`: unknown operators (e.g. a typo like `$gte:` → `$get:`) silently degrade to equality. An agent sending `{ age: { $get: 21 } }` gets `age = 21` rows back with HTTP 200.
- `select` and `sort` column names pass through to Knex identifier binding (safe from injection), but there is no per-service field whitelist — any column, including ones the service never exposes, is filterable/sortable from HTTP.

**Vector (Pinecone, Qdrant, pgvector)** — three implementations of `VectorRepository`, mutually inconsistent:

- **Similarity is unreachable from the Service/HTTP layer.** `findSimilar` exists only on the repository; there is no convention for exposing it as a service method, no `$similar`/`$vector` query extension, and the six standard `Service<T>` methods can't carry an embedding. Agents can only use vector search if the app author hand-writes a custom method and registers it.
- **Similarity scores are inconsistent:** `KnexVectorRepository.findSimilar` returns a synthetic `_distance` column (`packages/knex/src/lib/knex-vector-repository.ts:36-38`); Pinecone and Qdrant discard the match score entirely (`pinecone-repository.ts:62-64`, `qdrant-repository.ts:67`). Cross-adapter code cannot rank or threshold results.
- **Silent operator loss:** `pinecone-filter.ts:18` documents that `$like/$ilike/$notlike` are "silently ignored" — a filtered `findAll` returns *more* rows than requested with no error. Qdrant maps `$like` to full-text `match.text` (`qdrant-filter.ts:71-77`), which has different semantics than SQL LIKE.
- **`PineconeRepository.findAll` with a `where` clause queries with a zero vector and `topK = skip + limit` (`pinecone-repository.ts:89-96`)** — subject to Pinecone's top-k ceiling and undefined ordering; `count(where)` does a full `findAll` and returns `.length` (`pinecone-repository.ts:227`) — O(n) with no warning.

**Graph (Neo4j)** — `GraphRepository` correctly refuses to pretend `where` can express traversals, offering `traverse()` and a `cypher()` escape hatch instead. Gaps:

- **Injection:** sort field names are interpolated into Cypher unparameterized (`neo4j-repository.ts:123` — `` `n.${field} ${dir}` ``). Where *values* are parameterized (`neo4j-where.ts`), but where/sort *field names* are not sanitized. Fix: whitelist against an identifier regex (`/^[A-Za-z_][A-Za-z0-9_]*$/`) or a declared field list, and throw `BadRequest` otherwise.
- `traverse(startId, relation, depth)` supports only a single relationship type and outbound direction — no direction parameter, no multi-type, no path/relationship-property results. Adequate for Phase 3; extend rather than force into `QueryParams`.

**Key-value (DynamoDB)** — the most thoughtful adapter (Query-vs-Scan selection at `dynamodb-repository.ts:109-117`, `buildKeyCondition` splitting key vs. filter conditions), but:

- **The `{ field: null }` bug** (`dynamodbify.ts:85`): the expression references `:null_${ctx.valIdx - 1}` without ever adding it to `ctx.values`. DynamoDB will reject the expression. Fix: register a NULL-typed AttributeValue alias explicitly.
- **Scan-by-default is invisible.** A `where` on a non-key field triggers a full table Scan with in-memory skip/sort (`dynamodb-repository.ts:123-200`) — correct results, potentially catastrophic cost, one `console.warn` for sort only (`:228`). This is precisely where a capability-introspection mechanism (§2.3) must say "this filter is a scan."
- **Cursor pagination leaks through mutable instance state** — `this.lastKey` (`dynamodb-repository.ts:55`) is set as a side effect of `findAll`, which is not concurrency-safe (two overlapping finds on one repository instance clobber each other's cursor) and undiscoverable. The cursor belongs in the return value.
- `$like` silently becomes `contains()` (`dynamodbify.ts:139-143`) — different semantics (substring, no wildcards) than every other adapter.

**Document (Supabase / Postgres JSON)** — the only adapter that **fails loudly** on unsupported operators (`supabase-repository.ts:227` throws `BadRequest`) — this should be the framework-wide norm. Gaps: no nested-JSON field addressing (PostgREST supports `metadata->>key` paths; the translator doesn't emit them), no array-containment operator (`cs`/`cd`), and `buildOrPart` (`supabase-repository.ts:231-246`) stringifies values into PostgREST syntax without escaping commas/parens — a value containing `,` corrupts the `or` filter (minor injection/correctness issue).

**Time-series** — no package exists and none is planned. Recommendation: **do not build a dedicated adapter in Phase 4/5.** The `KnexVectorRepository` pattern (a specialized repository extending `KnexRepository`, `knex-vector-repository.ts:13-16`) is the template: a `KnexTimeSeriesRepository` targeting TimescaleDB adds `timeBucket()` aggregation and `$between` range sugar on top of pg, at ~1/10 the cost of an InfluxDB/ClickHouse adapter. Defer a native TSDB adapter until demand exists; document the Timescale path in Phase 5.

**Polyglot multi-model (ArangoDB, OrientDB)** — the codebase already answers this question: `KnexVectorRepository` implements `Repository<T>` *and* `VectorRepository<T>` in one class within one package. An `@mantlejs/arangodb` implementing `Repository<T>` + `GraphRepository<T>` (both defined in core) follows the established pattern and violates nothing — "one package per backend" is the rule, not "one interface per package." Phase 4 PRD already defers ArangoDB to Phase 5; keep that, and note the dual-interface approach in the Phase 5 PRD.

### 2.3 Gap table

| # | Gap | Affected | Proposed solution | Effort |
|---|-----|----------|-------------------|--------|
| Q1 | Unknown/unsupported operators silently degrade (equality fallback or dropped) | knex (`knexify.ts:98`), dynamodb (`dynamodbify.ts:144-148`), pinecone (`pinecone-filter.ts:33-36`) | Framework-wide rule: throw `BadRequest("Unsupported operator $x for <adapter>")` like Supabase does (`supabase-repository.ts:227`). Add a shared `assertOperators(where, supported: Set<string>)` helper in `@mantlejs/mantle` | S |
| Q2 | `{ field: null }` filter broken on DynamoDB | dynamodb (`dynamodbify.ts:85`) | Register the null AttributeValue alias in `ctx.values` before referencing it; add spec | S |
| Q3 | Cypher injection via sort/where field names | neo4j (`neo4j-repository.ts:123`, `neo4j-where.ts:53-64`) | Validate field names against `/^[A-Za-z_][A-Za-z0-9_]*$/`, throw `BadRequest` on failure | S |
| Q4 | No capability introspection — callers can't know which operators/features an adapter supports or which queries are scans | all adapters | Add `describe(): RepositoryCapabilities` to `Repository<T>` with a default; adapters override. Shape: `{ operators: string[]; features: { pagination: "offset"\|"cursor"; fullTextSearch: boolean; scanWarning?: (where) => boolean }; fields?: FieldDescriptor[] }` (fields populated from the service's TypeBox schema when present) | M |
| Q5 | Vector search unreachable via services; scores inconsistent | pinecone, qdrant, knex-vector | (a) Standardize `findSimilar` to return `Array<T & { _score: number }>` across all three; (b) define a conventional custom service method `similar(data: { vector, topK, where })` registered via `methods: ["similar"]`, documented as the pattern; wire it in `@mantlejs/client` later | M |
| Q6 | DynamoDB cursor via mutable `this.lastKey` | dynamodb (`dynamodb-repository.ts:55,188-193`) | Introduce `CursorPage<T> = { data: T[]; cursor?: string }` and a `findPage(params): Promise<CursorPage<T>>` optional method; deprecate `lastKey` | M |
| Q7 | No nested-field / array-containment querying for JSON columns | supabase, (future mongodb) | Support dot-path field names (`"metadata.tags"`) in the translator; add `$contains` for array containment, mapped per adapter, rejected where unsupported (per Q1) | M |
| Q8 | PostgREST `or` string built without escaping values | supabase (`supabase-repository.ts:231-246`) | Escape/quote per PostgREST rules, or reject values containing `,()` with `BadRequest` | S |
| Q9 | Time-series unsupported | — (new) | `KnexTimeSeriesRepository` (TimescaleDB) in `@mantlejs/knex`, following the `KnexVectorRepository` precedent; Phase 5 | M |
| Q10 | Multi-model adapters unaddressed in planning | — (Phase 5) | Phase 5 PRD: `@mantlejs/arangodb` implements `Repository<T>` + `GraphRepository<T>` in one package (precedent: `knex-vector-repository.ts`) | L |

---

## 3. Auth architecture: current design vs. Arctic vs. Better Auth

### Recommendation

**Keep the `@mantlejs/auth` engine and the package-per-provider structure (ADR-001). Replace the hand-rolled OAuth internals in `@mantlejs/auth-oauth` with [Arctic](https://arcticjs.dev) as an implementation dependency. Do not adopt Better Auth.** Independently of that choice, four gaps in the current implementation must be fixed regardless (below).

### Why not Better Auth

Better Auth is a full framework: it owns its own database tables (users, sessions, accounts, verification), its own migration story, its own plugin system, and session-cookie-first semantics. Adopting it means:

- **The Dependency Rule dies at the auth boundary.** Better Auth requires a DB adapter binding (Kysely/Prisma/Drizzle-shaped); Mantle's `Repository<T>` abstraction can't own the user table anymore — Better Auth does. `findOrCreateUser` (`auth-oauth/src/lib/find-or-create.ts`) currently goes through the app's own `users` *service* — hooks, validation, and events all fire. Better Auth would bypass the entire hook pipeline for auth-driven user mutations.
- It duplicates what Mantle already has (JWT issuance, strategy dispatch via the `authentication` service, `authenticate("jwt")` hook) and would strand `@mantlejs/auth-local`'s Argon2id work.
- Its value (2FA, magic links, organizations, admin UI) is real but is Phase 5+ surface for Mantle; buying it now costs the architecture its core differentiator.

Better Auth is the right call for an app; it is the wrong call for a framework whose selling point is that the data layer is swappable.

### Why Arctic, and where

Arctic is the opposite shape: a zero-framework library of per-provider OAuth 2.0/OIDC clients (~60 providers), handling exactly the three things each Mantle provider package currently hand-writes — `buildAuthUrl`, `exchangeCode`, `fetchProfile`-adjacent token plumbing — with PKCE built in. It has no opinions about routing, sessions, or storage, so it slots *inside* `createOAuthPlugin` without touching any public Mantle API:

- `OAuthProvider` (`auth-oauth/src/lib/types.ts:23-29`) stays the public contract; provider packages become thin wrappers constructing an Arctic client. `google-strategy.ts` / `github-strategy.ts` / `facebook-strategy.ts` shrink to profile-normalization only.
- ADR-001's rationale (per-provider packages, per-provider auditability, PKCE support) is preserved — ADR-001 rejected `grant`, and Arctic has none of grant's problems (no session store, no config schema, PKCE-native).
- New providers become ~30 lines each instead of a full endpoint implementation, directly addressing ADR-001's stated "harder" consequence.
- Cost: one new external dependency in `auth-oauth`; migration is internal-only. Write this up as **ADR-002** when implemented.

### Gaps that must be fixed regardless of the library choice

| # | Gap | Evidence | Fix |
|---|-----|----------|-----|
| A1 | OAuth plugin requires Express specifically | `create-oauth-plugin.ts:38-41` (`app.get("express")`, error message names `@mantlejs/express`) | Define a transport-neutral route-registration contract in core (e.g. `app.get("http:router")` satisfying `RouterLike`, which each transport provides); `RouterLike` is already structurally minimal (`create-oauth-plugin.ts:9-14`) |
| A2 | In-memory OAuth state store breaks multi-instance deploys (Cloud Run is the documented target) | `state-store.ts` via `createStateStore()` (`create-oauth-plugin.ts:48`) | Extract a `StateStore` interface (`set/get/delete/cleanup`), default in-memory, injectable via `OAuthPluginConfig.stateStore`; ship a Redis implementation in `@mantlejs/sync` or accept any conforming object |
| A3 | Refresh token minted but unmanaged: no refresh endpoint, no rotation, no revocation; same-expiry JWT with `type:"refresh"` | `create-oauth-plugin.ts:106`; Phase 4 client checklist item 1 assumes `POST /authentication/refresh` | Add to `@mantlejs/auth`: distinct refresh expiry (`AuthConfig.refreshExpiresIn`), an `authentication/refresh` service method that verifies `type==="refresh"`, and a pluggable `RefreshTokenStore` (jti allowlist) enabling rotation + revocation. **Blocker for Phase 4 item 1** |
| A4 | `authenticate("jwt")` sets `params.user` to the raw JWT payload, not the user record | `auth/src/lib/authenticate.ts:55` — downstream hooks see `{ sub, iat, exp }`, not the user entity; local-strategy flows likely expect the entity | Optionally resolve the entity: `authenticate("jwt", { entity: "users" })` fetches `app.service(entity).get(payload.sub)` (internal call) and sets both `params.user` and `params.authPayload` |

---

## 4. Phase 4/5 roadmap gaps

Assessed against `docs/planning/mantle-js-phase-4-prd.md` and `mantle-js-phase-4-checklist.md`. The Phase 4 slate (client, react, mongodb, openapi, batch, CORS, storage read/delete, first release) is coherent. What's missing or mis-sequenced:

**Add to Phase 4 (blockers or force-multipliers for existing items):**

1. **Refresh-token service (A3)** — checklist item 1 (`@mantlejs/client`) specifies "on 401, attempt one token refresh via `POST /authentication/refresh`" against an endpoint that doesn't exist. Either add the endpoint (recommended, see A3) or descope refresh from the client. This is an ordering bug in the current plan.
2. **A `RepositoryService<T>` base class in core** — a default `Service<T>` implementation that bridges to a `Repository<T>`: parses/validates `params.query` into `QueryParams`, applies a field whitelist, coerces string values via the service's TypeBox schema, and returns a consistent `Paginated<T>`. Without it, `@mantlejs/openapi` (item 4) has no consistent query-parameter semantics to document and `@mantlejs/client` has no consistent pagination shape to deserialize. This is the fix for finding #1 and it makes three other Phase 4 items simpler. FeathersJS's equivalent (`AdapterService` — the ready-made service class its adapter packages export, so `app.use("/messages", new KnexService({...}))` gives a fully working CRUD endpoint with query parsing and pagination, zero custom code) is the single biggest parity gap not in the original plan; `RepositoryService<T>` closes it while keeping data access behind `Repository<T>`, which FeathersJS doesn't.
3. **Operator hardening pass (Q1-Q3, Q8)** — small, and should land before the first public npm release ships silently-wrong query behavior.

**Also add to Phase 4** (feature additions, after the blockers above — everything from the AI-first review in §6 lands in Phase 4 except `@mantlejs/mcp`):

4. **Repository capability introspection (Q4)** and **cursor pagination (Q6)** — `describe()` also feeds the Phase 4 OpenAPI generator directly.
5. **Vector search service convention (Q5)** — standardized `_score`, the `similar()` service-method pattern, and client wiring in `@mantlejs/client`.
6. **Auth: Arctic migration (ADR-002)** and **Redis-backed `StateStore`/`RefreshTokenStore` implementations** — the A2/A3 minimal versions (interface + in-memory default) land first; the Arctic rewrite and Redis backends follow within the phase.
7. **Introspection surface:** `ServiceHandle.describe()` including emitted-event enumeration (§5.3), plus the opt-in `/_services` endpoint.
8. **Nested-path + `$contains` JSON querying (Q7)** — Supabase now, `@mantlejs/mongodb` as it lands.
9. **Supabase change-feed re-emissions marked external + UPDATE→patched documented (E7).**

**Add to Phase 5:**

10. **`@mantlejs/mcp`** — expose registered services as MCP tools (see §6.3). Depends on `describe()` (Q4) and the OpenAPI groundwork, both now Phase 4 — so MCP starts Phase 5 unblocked.
11. **`KnexTimeSeriesRepository`** (Q9) and **`@mantlejs/arangodb`** (Q10) — make them explicit PRD entries with the dual-interface design note.

**Resequence within Phase 4:** `RepositoryService<T>` and the refresh endpoint before `@mantlejs/client`/`@mantlejs/openapi`; operator hardening before item 8 (npm release); the feature additions (items 4-9 above) after the corresponding blockers but before the release cut.

---

## 5. Real-time events: channels & cross-instance sync

### 5.1 How it works today (verified flow)

The pipeline is clean and correctly layered:

1. A successful mutation emits `service:event` on the app bus (`packages/mantle/src/lib/application.ts:166-169`).
2. `@mantlejs/socketio` listens, resolves a publisher (service-level via `ServiceHandle.publish()`, falling back to the app-level `__globalPublisher`), maps the result to channels, and fans out to sockets (`packages/socketio/src/lib/socketio.ts:215-227`). No publisher → no broadcast — safe-by-default, correctly so.
3. `@mantlejs/sync` also listens on `service:event`, republishes to a broker (Redis pub/sub), and re-emits foreign instances' messages onto the local bus with origin-ID dedup (`packages/sync/src/lib/sync.ts:51-67`), where the local socketio wiring picks them up.

Channel membership deliberately stays per-instance (the `ChannelRegistry` at `socketio.ts:118-136` holds local socket connections); each instance runs the publisher against its own membership. That is the correct architecture for horizontal scaling — same model FeathersJS uses — and the `SyncAdapter` interface (`sync.ts:13-17`) is appropriately minimal. The findings below are implementation gaps, not design flaws.

### 5.2 Findings

| # | Finding | Evidence | Fix |
|---|---------|----------|-----|
| E1 | **Sensitive data published to the broker.** `SyncMessage.params` carries the full `ServiceParams` — for a REST call that includes `headers` (with the raw `Authorization` bearer token) and `params.user`. Anyone with broker read access harvests live JWTs; payloads also land in Redis logs/monitoring | `sync.ts:51-62` (message built from `params` verbatim); headers confirmed present in params by `auth/src/lib/authenticate.ts:31-33` reading `context.params.headers` | Whitelist what crosses the wire: publish only `{ provider, user: { id }, query }` or an explicit `params.sync` sub-object. Never forward `headers` or `connection`. **P0, pre-release** |
| E2 | **Non-serializable params cross a JSON boundary silently.** `params.connection` (per-socket mutable state, `types.ts:40-41`) and anything a hook attached to params is `JSON.stringify`-ed on publish and revived as plain JSON — receiving-side publishers that inspect `params.connection` or class instances see different shapes locally vs. cross-instance | `sync.ts:52-58`, `redis-adapter.ts:65,74` | Same fix as E1 — a defined wire-schema for the params subset makes local/remote behavior identical |
| E3 | **`ServiceParams.rooms` is a phantom API.** The doc comment promises "the socket.io transport will broadcast only to these rooms" but no code in `@mantlejs/socketio` reads `rooms` — broadcast is publisher/channel-driven only | `types.ts:42-43` vs. zero references in `socketio.ts` | Either implement it in `broadcastToChannels` (intersect publisher channels with `params.rooms` names) or delete the field and comment. Don't ship a documented no-op in 0.1.0 |
| E4 | **`ServiceOptions.events` is stored but never consumed** (same pattern as `schema`). Custom events declared per service are never emitted — `SERVICE_EVENTS[method]` covers the six standard methods only, so custom methods dispatched via `dispatch()` emit nothing | `application.ts:248` (stored), `application.ts:166-169` (only standard-method lookup) | Emit `service:event` for custom methods listed in `events`, or drop the option until it does something |
| E5 | **`@mantlejs/socketio` requires the Express transport** — it monkey-patches `app.listen` and throws if absent, naming `@mantlejs/express` specifically. Koa/http users get no real-time. Same theme as auth finding A1 | `socketio.ts:295-297` | The transport-neutral contract proposed for A1 covers this: transports register a listen/server handle under a neutral key (`http:server`); socketio consumes that |
| E6 | **Delivery semantics are undefined and undocumented.** Redis pub/sub is at-most-once — a briefly disconnected subscriber silently loses events. The Phase 4 `@mantlejs/react` cache-invalidation design (checklist item 2) depends on these events; missed events mean stale caches with no recovery signal | `redis-adapter.ts:58-69` (plain subscribe, no streams/acks); phase-4-checklist item 2 | Document at-most-once semantics in the sync README, and have `@mantlejs/client` expose a `reconnect` event so `@mantlejs/react` can `invalidateQueries()` wholesale on socket reconnect — turning lost-event windows into a bounded staleness problem |
| E7 | **Supabase change-feed events skip the event-name convention.** External DB mutations re-emitted as `service:event` map `UPDATE → "patched"` — never `"updated"` — and carry `{}` params, so publishers filtering on `params` treat them differently from hook-pipeline events with no way to distinguish external origin | `supabase-repository.ts:91-114` | Add `params: { external: true }` to the re-emission and document the UPDATE→patched choice in the supabase README |

### 5.3 AI-first note on events

Event names are convention-only strings (`"${path} ${event}"`, `socketio.ts:226`) discoverable nowhere at runtime. When `describe()` lands (Q4/§6.2), `ServiceDescriptor` should enumerate the events a service emits — that single addition makes the real-time surface as introspectable as the request/response surface, and is what `@mantlejs/mcp` would use to expose subscriptions as MCP resources rather than tools.

---

## 6. AI-first API design review

The framework is unusually AI-legible in places — function-based hooks, typed errors, a small orthogonal method surface, per-provider auth packages readable in one file. The gaps cluster around *discoverability* and *determinism*.

### 6.1 Where an LLM-driven caller guesses wrong today

- **String-typed queries with no coercion.** `?age[$gt]=21` reaches the repository as `{ age: { $gt: "21" } }` (`express/src/lib/routes.ts:8` casts `req.query` straight through). Whether that works depends on the database's string-comparison semantics. An agent that "successfully" filters on SQLite silently mis-filters on DynamoDB. Fixed by `RepositoryService<T>` + schema-driven coercion (§4 item 2).
- **`find(): Promise<T[] | Paginated<T>>`** (`types.ts:56`) — result shape is implementation-dependent. Standardize on `Paginated<T>` in `RepositoryService` and document plain-array as the exception, or add `findPage()` and narrow `find()` to `T[]`. Either way, one shape per method.
- **Silent operator degradation** (Q1) is worst-in-class for agents: the failure mode of a malformed query is *plausible-looking wrong data*, which propagates into the agent's reasoning. Fail-loud (`BadRequest` naming the unsupported operator and the supported set) converts a silent error into a self-correcting one — the error message is the documentation.
- **Error `code` is the HTTP status number** (`errors.ts:2`), and `className` is the only stable slug. Two improvements: (a) rename in docs so agents key on `className` (machine-stable) rather than parsing `message`; (b) add an optional `hint?: string` field to `MantleError.toJSON()` for remediation guidance (e.g. `"supported operators: $lt, $lte, $gt, $gte, $in"`). Error messages are the highest-leverage AI-first surface in the framework — they are what the model actually reads when a call fails.
- **`update` vs `patch`** both take `D = Partial<T>` (`types.ts:59-60`), so the type system doesn't express that `update` is full-replace. `updateById` on DynamoDB rewrites only provided attrs minus keys (`dynamodb-repository.ts:324-327`) — replace-semantics differ by adapter. Document per-adapter semantics in `describe()`; consider `update(id, data: Required-ish<D>)` in a future major.

### 6.2 Introspectability

`ServiceOptions.schema` (`types.ts:130-131`) is stored "for tooling introspection" but nothing consumes it, and there is no way to ask a running app what it can do. Concrete additions:

- **`Repository.describe(): RepositoryCapabilities`** (Q4) — operators, pagination mode, scan warnings, adapter name.
- **`ServiceHandle.describe(): ServiceDescriptor`** — `{ path, methods, schema (JSON Schema — TypeBox is already JSON Schema), capabilities, authRequired }`; `authRequired` detectable the same way the OpenAPI plugin plans to (checklist item 4).
- **`GET /_services` (opt-in)** — machine-readable directory of `ServiceDescriptor`s. The OpenAPI document (Phase 4) covers human/tooling consumption; this covers cheap runtime discovery for agents without parsing a full OpenAPI doc.

### 6.3 MCP fit

The mapping is nearly mechanical, which is a signal the architecture is right: each service method → one MCP tool (`users_find`, `users_create`, …), input schema from the TypeBox schema + a generated `QueryParams` schema constrained to the adapter's supported operators, descriptions from `describe()`. Everything routes through `service.dispatch()` so the full hook pipeline (auth, validation, events) applies — no bypass. Missing prerequisites: Q4 (`describe()`), the schema actually being consumed, and stable pagination shape. Propose **`@mantlejs/mcp`** for Phase 5, depending only on `@mantlejs/mantle`, consistent with the dependency matrix.

### 6.4 Batch (Phase 4) — one adjustment

The planned `BatchResult[]` (checklist item 5) should carry, per failed call, the full `MantleError.toJSON()` including the `hint` field proposed above — agents batching 25 calls need per-call machine-readable failure reasons, not just settled/rejected.

---

## 7. Cross-package sweep: transports, storage, schema

A pass over the packages the four main sections didn't reach (`http`, `koa`, `storage*`, `schema`, `memory`, `config`, `logger`, `cli`). Three findings matter; the rest are clean — notably `@mantlejs/memory` implements the *full* operator set including `$like/$ilike/$notlike` (`packages/memory/src/lib/memory-repository.ts:154-207`), making it a correct reference implementation for tests.

| # | Finding | Evidence | Fix |
|---|---------|----------|-----|
| X1 | **Transport-dependent query semantics.** Express parses `?age[$gt]=21` into nested objects (qs); `@mantlejs/http` uses flat `URLSearchParams` so the same request produces the key `"age[$gt]"` (`http.ts:51,77`); Koa's `ctx.query` is likewise flat (`koa/src/lib/routes.ts:9`). Every operator-based query silently breaks on two of the three HTTP transports — no error, just an equality match against a garbage field name | `packages/http/src/lib/http.ts:51,77`, `packages/koa/src/lib/routes.ts:9`, vs `packages/express/src/lib/routes.ts:8` | Add a shared bracket-notation query parser to `@mantlejs/mantle` (or the proposed `RepositoryService<T>`) and use it in all three transports, so `params.query` has one canonical shape regardless of transport. **P0, pre-release** — this ships silently-wrong behavior otherwise |
| X2 | **Path traversal in default disk-storage filename.** `` `${Date.now()}-${info.originalname}` `` is joined into the destination unsanitized; `originalname` is attacker-controlled multipart metadata. `a/../../../x` escapes the upload root | `packages/storage/src/lib/disk-storage.ts:14-15` | Apply `path.basename()` to `originalname`, strip path separators and null bytes, and after `path.join` verify the resolved path is still under `config.destination` (`path.resolve` + prefix check). Same check belongs in the Phase 4 `retrieve()`/`delete()` additions (checklist item 7), where a traversal in `key` would otherwise read/delete arbitrary files |
| X3 | **No query-schema helper in `@mantlejs/schema`.** `validate(schema, { target: "query", coerce: true })` exists and works (`packages/schema/src/lib/validate.ts:47,69`) — but a plain entity schema rejects operator objects: `{ age: { $gt: 21 } }` fails validation against `Type.Number()`. There is no equivalent of FeathersJS's `querySyntax` to derive an operator-aware query schema from an entity schema, so in practice nobody can validate or coerce queries | `packages/schema/src/lib/validate.ts` (mechanism exists, no schema builder) | Add `querySyntax(entitySchema, { operators?, fields? })` to `@mantlejs/schema` producing a TypeBox schema that allows the supported operator forms per field. This is the missing piece that makes `RepositoryService<T>`'s coercion/whitelisting declarative, and it feeds `describe()` and the OpenAPI generator for free |

---

## 8. Prioritized action backlog

| Item | Area | Priority | Effort | Target phase |
|------|------|----------|--------|--------------|
| Fix DynamoDB `{ field: null }` broken alias (Q2) | Query | P0 | S | Phase 4 (pre-release) |
| Whitelist Neo4j sort/where field identifiers (Q3) | Query/Security | P0 | S | Phase 4 (pre-release) |
| Fail-loud on unsupported operators everywhere (Q1) + shared `assertOperators` helper | Query | P0 | S | Phase 4 (pre-release) |
| Stop publishing `headers`/full params to the sync broker — whitelist wire fields (E1, E2) | Events/Security | P0 | S | Phase 4 (pre-release) |
| Sanitize disk-storage filenames + containment check (X2) | Storage/Security | P0 | S | Phase 4 (pre-release) |
| Canonical query parsing across express/koa/http transports (X1) | Transports | P0 | S | Phase 4 (pre-release) |
| Implement or delete `ServiceParams.rooms` (E3); wire or drop `ServiceOptions.events` (E4) | Events | P1 | S | Phase 4 (pre-release) |
| Rename `GraphRepository.cypher()` → `raw()` — Neo4j-specific name in the neutral core contract; free now, semver-major after 0.1.0 | Core/API | P1 | S | Phase 4 (pre-release) |
| Refresh-token service in `@mantlejs/auth` (A3) — unblocks `@mantlejs/client` | Auth | P0 | M | Phase 4 (before client) |
| `RepositoryService<T>` in core: query parsing, schema coercion, field whitelist, `Paginated<T>` | Core/AI-first | P0 | M | Phase 4 (before openapi/client) |
| `querySyntax()` query-schema builder in `@mantlejs/schema` (X3, feeds RepositoryService) | Schema | P1 | M | Phase 4 |
| Escape/reject unsafe values in Supabase `or` builder (Q8) | Query | P1 | S | Phase 4 |
| Transport-neutral router contract for OAuth (A1) | Auth | P1 | M | Phase 4 |
| Injectable OAuth `StateStore` (A2, minimal: interface + config knob) | Auth | P1 | S | Phase 4 |
| `authenticate("jwt", { entity })` resolves user record (A4) | Auth | P1 | S | Phase 4 |
| Document at-most-once event delivery; reconnect-triggered cache invalidation in client/react (E6) | Events | P1 | S | Phase 4 (with client/react) |
| Decouple socketio from Express via neutral server handle (E5, rides on A1) | Events | P1 | M | Phase 4 |
| Mark Supabase change-feed re-emissions as external; document UPDATE→patched (E7) | Events | P2 | S | Phase 4 |
| Enumerate emitted events in `ServiceDescriptor` (§5.3, extends Q4) | AI-first | P2 | S | Phase 4 |
| Standardize `findSimilar` return to include `_score` (part of Q5) | Vector | P1 | S | Phase 4 |
| Add `hint` field to `MantleError`; audit adapter error messages for actionability | AI-first | P1 | S | Phase 4 |
| `Repository.describe()` capabilities (Q4) | AI-first | P1 | M | Phase 4 |
| `ServiceHandle.describe()` + opt-in `/_services` endpoint | AI-first | P1 | M | Phase 4 |
| ADR-002: adopt Arctic inside `auth-oauth`; shrink provider packages | Auth | P2 | M | Phase 4 |
| Cursor pagination `findPage()` / deprecate DynamoDB `lastKey` (Q6) | Query | P2 | M | Phase 4 |
| `similar()` service-method convention + client wiring (Q5) | Vector | P2 | M | Phase 4 |
| `@mantlejs/mcp` — services as MCP tools | AI-first | P2 | L | Phase 5 |
| Nested-path + `$contains` JSON querying (Q7) | Query | P2 | M | Phase 4 |
| Redis-backed `StateStore`/`RefreshTokenStore` | Auth | P2 | M | Phase 4 |
| `KnexTimeSeriesRepository` (TimescaleDB) (Q9) | Query | P2 | M | Phase 5 |
| `@mantlejs/arangodb` (Repository + GraphRepository) (Q10) | Query | P2 | L | Phase 5 |

**Suggested first implementation slice** (hand this table to an implementation session and start here): the seven P0 pre-release items — operator hardening (Q1-Q3), sync param whitelisting (E1), storage filename sanitization (X2), and canonical transport query parsing (X1) — are independent, small, and each has a cited file/line; `RepositoryService<T>` and the refresh-token service are the two P0 design tasks and should each get a short TDD section in the Phase 4 TDD before coding.
