# Mantle JS — AI-First Review Remediation Checklist

Implementation checklist for [`ai-first-architecture-review.md`](./ai-first-architecture-review.md). Each item is
self-contained: file/line targets, expected behavior, and acceptance criteria. Work one item per session where
possible; after each item run `npx nx run-many -t test,lint` for the affected packages and check the box.

Finding IDs (Q*, A*, E*, X*) refer to the review's tables. Tier A items are independent of each other and of
Phase 4 — do them first, in any order. Tier B items are design tasks: **write a TDD section in
[`mantle-js-phase4-tdd.md`](./mantle-js-phase4-tdd.md) before coding.** Tier C items amend existing Phase 4
checklist items and should be folded into those work sessions. Tier D items are Phase 4 feature additions —
schedule them after Tiers A-C land (D-1/D-2 before the OpenAPI session; D-4 after the client exists), and all of
them before the Phase 4 item 8 release cut.

---

## Tier A — Pre-release fixes (P0, independent, small)

- [x] **A-1. Fix DynamoDB `{ field: null }` filter (Q2)**
      `packages/dynamodb/src/lib/dynamodbify.ts:84-86` builds `(attribute_not_exists(#n) OR #n = :null_N)` but never
      registers `:null_N` in `ctx.values` — DynamoDB rejects the expression at runtime. Fix: register the alias
      explicitly via the existing `valueAlias(null, ctx)` (marshalls to `{ NULL: true }`) and interpolate the returned
      alias name instead of the hand-built `:null_${ctx.valIdx - 1}` string.
      **Accept:** new spec in `dynamodbify.spec.ts` asserting that for `{ deletedAt: null }` every `:alias` referenced in
      `expression` exists as a key in `values`; integration-style spec (mocked client) that `findAll({ where: { x: null } })`
      sends a well-formed `FilterExpression`.

- [x] **A-2. Whitelist Neo4j field identifiers (Q3)**
      `packages/neo4j/src/lib/neo4j-repository.ts:123` interpolates sort field names into Cypher unparameterized
      (`` `n.${field} ${dir}` ``), and `packages/neo4j/src/lib/neo4j-where.ts` interpolates where-clause _field names_
      (values are parameterized, names are not). Both can originate from HTTP `params.query`. Fix: in both files,
      validate every field identifier against `/^[A-Za-z_][A-Za-z0-9_]*$/` and throw
      `BadRequest("Invalid field name: <name>")` on failure. Apply to sort keys, where keys, and `select` if used.
      **Accept:** specs proving `findNodes({ sort: { "id} RETURN n //": "asc" } })` and a malicious where key both throw
      `BadRequest` and never reach `session.run`.

- [x] **A-3. Fail loud on unsupported query operators everywhere (Q1)**
      Today unknown/unsupported operators silently corrupt results. Three changes, one convention:
      (a) Add `assertOperators(where: Record<string, unknown>, supported: ReadonlySet<string>, adapterName: string): void`
      to `@mantlejs/mantle` (new `packages/mantle/src/lib/query-operators.ts`, export from `src/index.ts`). It walks the
      where clause (recursing into `$or`/`$and` arrays and operator objects) and throws
      `BadRequest("Operator $x is not supported by <adapter>. Supported: $a, $b, …")` — the message lists the supported
      set, because for an agent the error text is the documentation.
      (b) Replace silent fallbacks with throws: `packages/knex/src/lib/knexify.ts:98-99` (default → equality),
      `packages/dynamodb/src/lib/dynamodbify.ts:144-148` (default → equality),
      `packages/pinecone/src/lib/pinecone-filter.ts:33-36` (non-passthrough ops silently dropped).
      (c) DynamoDB's `$like`→`contains()` remapping (`dynamodbify.ts:139-143`) and Qdrant's `$like`→full-text
      (`qdrant-filter.ts:71-77`) are semantic lies; either reject `$like` in those adapters (preferred) or keep the
      mapping and say so in the package README — decide once, apply to both.
      `packages/supabase` already throws (`supabase-repository.ts:227`) — leave as the reference.
      **Accept:** per-adapter spec: an unknown operator (`$get`) throws `BadRequest` naming the operator and adapter;
      `@mantlejs/memory` (full operator support, `memory-repository.ts:154-207`) still passes untouched.

- [x] **A-4. Stop publishing credentials to the sync broker (E1, E2)**
      `packages/sync/src/lib/sync.ts:51-62` publishes the full `ctx.params` — including `headers.authorization` (the
      caller's live JWT), `params.user`, and the non-serializable `params.connection` — to Redis verbatim. Fix: build the
      wire message from a whitelist only: `{ provider: params.provider, query: params.query, user: params.user?.["id"] != null ? { id: params.user["id"] } : undefined }`.
      Never forward `headers` or `connection`. Narrow `SyncMessage.params`'s type to that shape.
      **Accept:** spec asserting that when a `service:event` fires with params containing
      `headers: { authorization: "Bearer x" }` and `connection: {...}`, the payload passed to `adapter.publish` contains
      neither; round-trip spec that a received message re-emits with the whitelisted shape.

- [x] **A-5. Sanitize disk-storage filenames (X2)**
      `packages/storage/src/lib/disk-storage.ts:14-15` joins client-controlled `originalname` into the destination path —
      `a/../../../x` escapes the upload root. Fix: (1) default filename uses `path.basename(info.originalname)` with null
      bytes stripped; (2) after `path.join`, verify containment:
      `const resolved = path.resolve(filepath); if (!resolved.startsWith(path.resolve(config.destination) + path.sep)) throw new BadRequest("Invalid upload filename")`.
      Apply the containment check even when a user-supplied `config.filename` function is in play. Note for Phase 4
      checklist item 7: the same containment check is mandatory in the upcoming `retrieve(key)`/`delete(key)` disk
      implementations, where a traversal in `key` reads/deletes arbitrary files.
      **Accept:** spec: `store()` with `originalname: "../../evil.sh"` writes inside `destination` (or throws) — never
      outside; spec with a `filename` config returning a traversal path throws.

- [x] **A-6. Canonical query parsing across all three HTTP transports (X1)**
      Express parses `?age[$gt]=21` into `{ age: { $gt: "21" } }` (qs); `@mantlejs/http` produces the flat literal key
      `"age[$gt]"` (`packages/http/src/lib/http.ts:51,77` — `Object.fromEntries(url.searchParams)`); Koa's `ctx.query`
      is also flat (`packages/koa/src/lib/routes.ts:9`). Operator queries silently break on two of three transports.
      Fix: add `parseQueryString(flat: Record<string, string | string[]>): Record<string, unknown>` to
      `@mantlejs/mantle` (bracket-notation parser handling `a[$gt]=1`, `$or[0][field]=v`, repeated keys → arrays; depth
      limit 5 to avoid abuse); call it in `packages/http/src/lib/routes.ts:6` (`buildParams`) and the Koa equivalent.
      Express output already matches — add a shared spec fixture asserting all three transports produce byte-identical
      `params.query` for the same query string. (This parser is also the input stage of Tier B-2.)
      **Accept:** cross-transport fixture spec (`?age[$gt]=21&$or[0][role]=admin&$or[1][role]=editor&tags[]=a&tags[]=b`)
      produces the identical nested object via express, koa, and http packages.

- [x] **A-7. Escape Supabase `or` filter values (Q8)**
      `packages/supabase/src/lib/supabase-repository.ts:231-246` stringifies values into PostgREST `or` syntax —
      a value containing `,` or `()` corrupts the filter. Fix: PostgREST supports double-quoting
      (`col.eq."val,ue"`); quote every value and escape embedded quotes, or throw `BadRequest` for values matching
      `/[,()"]/ ` — pick quoting if the PostgREST version in CI supports it, otherwise reject.
      **Accept:** spec: `$or` with value `"a,b"` either produces a correctly quoted filter string or throws — never a
      silently split filter.

---

## Tier B — Design tasks (P0, TDD section first, blocks Phase 4 items 1 & 4)

- [x] **B-1. Refresh-token service in `@mantlejs/auth` (A3)**
      Phase 4 checklist item 1 (`@mantlejs/client`) specifies retry-via-`POST /authentication/refresh` against an
      endpoint that does not exist. `packages/auth-oauth/src/lib/create-oauth-plugin.ts:106` mints
      `engine.createJwt({ sub, type: "refresh" })` — same secret, same expiry, no storage, no rotation, no revocation.
      Design (write into phase4 TDD first): (1) `AuthConfig.refreshExpiresIn` (default `"30d"`) —
      `packages/auth/src/lib/types.ts:3-9`; (2) refresh tokens get a `jti` claim and are recorded in a
      `RefreshTokenStore` (`add(jti, sub, exp)` / `consume(jti): boolean` / `revokeAll(sub)`), in-memory default,
      injectable via `AuthConfig`; (3) extend the `authentication` service (`packages/auth/src/lib/auth.ts:50-62`) —
      `create` with `{ strategy: "refresh", refreshToken }` verifies the JWT, checks `type === "refresh"`, atomically
      consumes the old `jti` (rotation — a reused token means theft: revoke all for that sub and throw
      `NotAuthenticated`), and returns a fresh access + refresh pair; (4) local strategy and OAuth callback both issue
      refresh tokens through the same helper so `jti` bookkeeping is uniform.
      **Accept:** specs for happy-path rotation, reuse-detection revoking the family, expiry, and `type` mismatch; the
      Phase 4 client item can then target `POST /authentication` with `strategy: "refresh"` (adjust the client spec
      wording or add the `/authentication/refresh` alias route — decide in the TDD).

- [x] **B-2. `RepositoryService<T>` in `@mantlejs/mantle` (review §4 item 2, exec finding 1)**
      There is no framework-owned bridge from `ServiceParams.query` (raw strings) to `QueryParams` — every service
      hand-rolls it, which breaks type coercion, invites unfiltered field access, and leaves `find()` returning an
      unpredictable `T[] | Paginated<T>`. Design (TDD first — this defines HTTP query semantics for OpenAPI and the
      client SDK): a concrete `RepositoryService<T, D>` implementing `Service<T, D>`, constructed with
      `(repository: Repository<T, D>, options: { schema?: TSchema-like; fields?: string[]; paginate?: { default: number; max: number } })`.
      Decisions to lock in the TDD: (1) reserved keys — adopt the FeathersJS convention `$limit`, `$skip`, `$sort`,
      `$select` _inside_ `query`, everything else is `where`; (2) `find()` always returns `Paginated<T>` (`total` via
      `repository.count(where)`); (3) field whitelist — where/sort/select keys not in `options.fields` (when provided)
      throw `BadRequest` naming the field and the allowed set; (4) string coercion — when `options.schema` is present,
      coerce where values against the field types (integration point for `querySyntax()`, item C-6); without a schema,
      pass strings through unchanged (document this); (5) `update`/`patch`/`remove` propagate the repository's
      `NotFound` untouched. Export from `packages/mantle/src/index.ts`; keep zero external deps (schema coercion is
      duck-typed or callback-injected, not a TypeBox import — `@mantlejs/mantle` depends on nothing).
      **Accept:** spec suite covering all six methods against `@mantlejs/memory`; a full HTTP round-trip spec (express)
      where `?age[$gt]=21&$limit=10&$sort[name]=asc` hits a `RepositoryService` and returns a `Paginated` envelope with
      correctly coerced/filtered results; README section in `packages/mantle`.

---

## Tier C — Fold into existing Phase 4 checklist items (P1)

- [x] **C-1. Transport-neutral router/server contract (A1 + E5)** — with Phase 4 items 5/6 (transport work).
      Convention: every HTTP transport registers `app.set("http:router", RouterLike)` and exposes listen via
      `app.set("http:server", ...)`. Consumers migrate: `create-oauth-plugin.ts:38-41` reads `http:router` instead of
      `"express"`; `packages/socketio/src/lib/socketio.ts:295-297` stops monkey-patching Express-specific `listen`.
      Keep the old keys registered for one release with a deprecation note.

- [x] **C-2. Injectable OAuth `StateStore` (A2)** — with any auth-oauth session.
      Extract the `createStateStore()` shape (`packages/auth-oauth/src/lib/state-store.ts`) into an exported
      `StateStore` interface; add `OAuthPluginConfig.stateStore?: StateStore`. In-memory stays the default; document
      that multi-instance deployments (Cloud Run) must inject a shared store.

- [x] **C-3. `authenticate("jwt", { entity })` resolves the user record (A4)** — with Phase 4 item 1 (client),
      since the client's `params.user` expectations depend on it. `packages/auth/src/lib/authenticate.ts:55` currently
      sets `params.user` to the raw JWT payload. Add an options arg: when `entity` is provided, fetch
      `app.service(entity).get(payload.sub)` (internal call, no provider) into `params.user` and keep the payload as
      `params.authPayload`. Default behavior unchanged.

- [x] **C-4. Standardize `findSimilar` to return `_score` (Q5 partial)** — one session across
      `packages/knex/src/lib/knex-vector-repository.ts` (rename `_distance`→ keep both for one release),
      `packages/pinecone/src/lib/pinecone-repository.ts:62-64`, `packages/qdrant/src/lib/qdrant-repository.ts:67`
      (both currently discard the match score). Return type: `Promise<Array<T & { _score: number }>>`; document the
      metric direction (higher-is-better vs distance) per adapter README.

- [x] **C-5. `MantleError.hint` field (review §6.1)** — small core change, then opportunistic adoption.
      Add optional `hint?: string` to `MantleError` constructor + `toJSON()` (`packages/mantle/src/lib/errors.ts`).
      Adopt in the A-3 operator errors and B-2 whitelist errors first — the highest-traffic agent-facing messages.

- [x] **C-6. `querySyntax()` in `@mantlejs/schema` (X3)** — after B-2 lands, feeding it.
      `validate(schema, { target: "query", coerce: true })` exists (`packages/schema/src/lib/validate.ts:47,69`) but a
      plain entity schema rejects operator objects. Add `querySyntax(entitySchema, options?)` producing a TypeBox
      schema that, per field, allows the bare value or an operator object (`$gt`/`$lt`/… typed to the field), plus
      `$limit`/`$skip`/`$sort`/`$select` reserved keys matching B-2's convention.

- [x] **C-7. `rooms` and `events`: implement or delete (E3, E4)** — with Phase 4 item 5 (transports/batch) or
      _(Resolved: both implemented — `params.rooms` now targets named channels in the socket.io broadcast,
      and custom methods listed in `ServiceOptions.events` emit `service:event` on dispatch.)_
      standalone. `ServiceParams.rooms` (`packages/mantle/src/lib/types.ts:42-43`) is a documented no-op — either
      implement room filtering in `broadcastToChannels` (`socketio.ts:155-174`) or delete field + comment.
      `ServiceOptions.events` (`application.ts:248`) is stored but never emitted — either emit `service:event` for
      custom methods listed in it, or drop the option. Don't ship phantom APIs in 0.1.0.

- [ ] **C-8. Event-delivery semantics + reconnect invalidation (E6)** — with Phase 4 items 1/2 (client/react).
      Document at-most-once delivery in the `@mantlejs/sync` README; `@mantlejs/client` emits a `reconnect` event;
      `@mantlejs/react` calls `queryClient.invalidateQueries()` on it, bounding staleness from missed events.
      _(Partially done: sync README now documents at-most-once delivery and the refetch-on-reconnect contract.
      Remaining: the `reconnect` event and `invalidateQueries()` wiring — blocked until `@mantlejs/client` and
      `@mantlejs/react` exist; fold into Phase 4 items 1/2.)_

---

## Tier D — Phase 4 feature additions (P1-P2, after Tiers A-C, before the release cut)

Formerly deferred; pulled into Phase 4. D-1 and D-2 should land before the `@mantlejs/openapi` session (Phase 4
item 4) so the generator can consume them; D-4 needs `@mantlejs/client` (Phase 4 item 1) to exist first.

- [x] **D-1. `Repository.describe()` capability introspection (Q4)**
      Add to `@mantlejs/mantle` (`packages/mantle/src/lib/types.ts`): a `RepositoryCapabilities` interface —
      `{ adapter: string; operators: string[]; pagination: "offset" | "cursor" | "both"; fullTextSearch: boolean; scanning?: (where: Record<string, unknown>) => boolean }`
      — and an optional `describe?(): RepositoryCapabilities` on `Repository<T>` (optional so existing user repositories
      don't break). Implement in all six adapters + `@mantlejs/memory`; the operator lists must be the same sets used by
      the Tier A-3 `assertOperators` calls (one source of truth — export the set constant from each adapter).
      DynamoDB's `scanning` predicate returns true when the where clause lacks the partition key (mirrors the
      Query-vs-Scan branch at `dynamodb-repository.ts:109-117`).
      **Accept:** per-adapter spec asserting `describe().operators` exactly matches what `assertOperators` accepts;
      dynamodb spec for `scanning()` on key vs non-key wheres.

- [x] **D-2. `ServiceHandle.describe()` + opt-in `/_services` endpoint + event enumeration (§6.2, §5.3)**
      Add `describe(): ServiceDescriptor` to `ServiceHandle` (`packages/mantle/src/lib/types.ts:140-147`):
      `{ path, methods, events, schema, capabilities?, authRequired? }` — `schema` is the stored `ServiceOptions.schema`
      (JSON Schema via TypeBox — this finally consumes the stored-but-unused field, `types.ts:130-131`); `events` lists
      emitted event names (the standard created/updated/patched/removed set filtered by registered methods, plus
      custom `ServiceOptions.events` once C-7 wires them); `capabilities` comes from the repository's D-1 `describe()`
      when the service exposes one (the `RepositoryService<T>` from B-2 wires this through); `authRequired` detected the
      same way the OpenAPI plugin detects `authenticate("jwt")` in `before.all`. Then add an opt-in
      `introspection?: boolean | { path?: string }` option to each transport that mounts `GET /_services` returning
      `ServiceDescriptor[]`. Off by default.
      **Accept:** spec: a `RepositoryService` over `@mantlejs/memory` with a TypeBox schema yields a descriptor with
      correct methods/events/operators; express spec that `/_services` 404s by default and serves JSON when enabled.

- [x] **D-3. Cursor pagination `findPage()` / deprecate DynamoDB `lastKey` (Q6)**
      _(Resolved: `CursorPage<T>` + optional `findPage()` in core; implemented in dynamodb (base64-JSON
      `LastEvaluatedKey`, Query-or-Scan, `lastKey`/`_startKey` deprecated), qdrant (scroll offset), and
      pinecone (`paginationToken`); knex/supabase omit it and `describe().pagination` reports availability.
      `skip`/`sort` — and `where` on pinecone — are rejected per the A-3 fail-loud convention.)_
      Add to core types: `CursorPage<T> = { data: T[]; cursor?: string }` and optional
      `findPage?(params?: QueryParams & { cursor?: string }): Promise<CursorPage<T>>` on `Repository<T>`.
      Implement where the backend is natively cursored: DynamoDB (encode `LastEvaluatedKey` as base64 JSON in `cursor`,
      replacing the mutable `this.lastKey` side channel at `dynamodb-repository.ts:55,188-193` — deprecate `lastKey`
      with a JSDoc `@deprecated`, remove in the next minor), Qdrant (scroll offset), Pinecone (`paginationToken`).
      Knex/Supabase may synthesize cursor from offset or omit the method — `describe().pagination` (D-1) reports which.
      **Accept:** dynamodb spec: two `findPage` calls with the returned cursor traverse a table without overlap and
      without touching instance state; concurrent `findPage` calls on one repository instance don't interfere.

- [ ] **D-4. `similar()` service-method convention + client wiring (Q5 remainder)**
      _(Partially done: `VectorRepositoryService` ships in `@mantlejs/mantle` with `similar()` pre-wired to
      `findSimilar` (vector/topK validation, `topK: { default, max }` option, field whitelist on `where`),
      the convention is documented in the mantle README, and an express round-trip spec covers
      `POST /docs/similar` through the hook pipeline. Remaining: `ServiceClient.similar(data)` — blocked
      until `@mantlejs/client` exists; fold into Phase 4 item 1 alongside C-8's reconnect wiring.)_
      C-4 standardizes `_score`; this item makes vector search reachable. Convention: services backed by a
      `VectorRepository` register a custom method `similar(data: { vector: number[]; topK?: number; where?: … }, params)`
      via `app.use(path, svc, { methods: [..., "similar"] })`, forwarding to `repository.findSimilar` — document the
      pattern in the mantle README and add a `VectorRepositoryService` variant of B-2's `RepositoryService` that ships
      it pre-wired. Client side: `ServiceClient` in `@mantlejs/client` gains `similar(data)` calling the custom method
      over REST (custom methods dispatch as POST per the transport convention).
      **Accept:** e2e-style spec: express + `VectorRepositoryService` over a stubbed vector repository; client
      `service("docs").similar({ vector, topK: 5 })` returns `_score`-bearing results through the full hook pipeline.

- [x] **D-5. ADR-002: adopt Arctic inside `auth-oauth` (review §3)**
      _(Resolved with one user-approved deviation from the accept criteria: the specs asserted implementation
      details — exact `fetch(url, options)` call shapes and hand-fed challenge propagation — that are
      incompatible with Arctic's `Request`-based fetches, and `AuthUrlParams.codeChallenge` conflicted with
      Arctic's verifier-based PKCE. Chosen: clean adoption — `AuthUrlParams.codeVerifier` replaces
      `codeChallenge` (pre-release cut, ADR-002 documents it), `pkce.ts` deleted in favor of Arctic's
      `generateState`/`generateCodeVerifier`, the three providers now delegate URL + exchange to Arctic with
      profile fetching hand-written, and only implementation-detail spec assertions were updated.)_
      Write `docs/decisions/adr-002-arctic-oauth-internals.md` first (follow adr-001's format: Context / Decision /
      Options Considered / Consequences — the review's §3 is the source material). Then: add `arctic` as a dependency of
      `@mantlejs/auth-oauth`; keep `OAuthProvider` (`auth-oauth/src/lib/types.ts:23-29`) as the unchanged public
      contract; rewrite the internals of `google-strategy.ts`, `github-strategy.ts`, `facebook-strategy.ts` to construct
      Arctic clients for `buildAuthUrl`/`exchangeCode` (profile fetching stays hand-written — Arctic doesn't normalize
      profiles). Delete the now-redundant hand-rolled endpoint/PKCE plumbing that Arctic covers; keep `pkce.ts` only if
      the state store still needs `generateState`. No public API change; existing provider specs must pass unmodified.
      **Accept:** all existing auth-\* specs green with no spec edits; ADR-002 merged.

- [x] **D-6. Redis-backed `StateStore` + `RefreshTokenStore` (generalizes C-2 and B-1)**
      _(Resolved: new `@mantlejs/auth-redis` package — the location decision and its rationale are in
      `docs/decisions/auth-redis-location.md`. Stores type the client structurally as `RedisClientLike`
      (ioredis-shaped, no hard ioredis dep; Redis ≥ 6.2), `redisStateStore` uses `SET … EX` with a no-op
      `cleanup()`, `redisRefreshTokenStore` rotates via `GETDEL` with a per-sub set for `revokeAll`.
      `OAuthStateStore` was widened to sync-or-async and `createOAuthPlugin` now awaits it. Specs run
      against `ioredis-mock` covering consume-once, `revokeAll`, and cross-instance sharing; auth +
      auth-oauth READMEs point at the package.)_
      Ship production implementations of the two stores whose interfaces C-2/B-1 introduce. Location decision (make in
      the session, document in the ADR-002 or a short note): either a new `@mantlejs/auth-redis` package (cleanest for
      the dependency matrix — depends on `mantle`, `auth`, `auth-oauth`) or optional exports behind an `ioredis` peer
      dep. Implement `StateStore` (SETEX with the state TTL) and `RefreshTokenStore` (`add`/`consume` via GETDEL for
      atomic rotation, `revokeAll` via a per-sub set). Update the auth README's Cloud Run section to point at it.
      **Accept:** integration specs against an in-process Redis mock (or `ioredis-mock`) covering consume-once
      semantics and `revokeAll`.

- [x] **D-7. Nested-path + `$contains` querying (Q7)**
      _(Resolved: `$contains` follows jsonb `@>` semantics everywhere — array ⊇ every operand element
      (scalar operand = one element), object ⊇ operand recursively. The shared conformance fixture lives in
      `@mantlejs/mantle` (`query-fixtures.ts`, the only package both adapters may depend on): memory runs it
      against real data as the executable reference; supabase asserts the PostgREST translation of every case.
      Supabase dot-paths use `->>` for string-operand comparisons and `->` otherwise; `$contains` scalar
      operands are wrapped in an array before `.contains()`/`whereJsonSupersetOf()`; `$contains` inside `$or`
      is rejected on supabase (PostgREST `or=` strings can't safely encode containment values). Knex rejects
      `$contains` on non-pg clients naming the operator and client; pinecone/qdrant/neo4j reject it via their
      existing `assertOperators` sets, now specced. DynamoDB's pre-existing `$contains` (native `contains()`:
      set membership/substring) is unchanged. `@mantlejs/mongodb` doesn't exist yet — Phase 4 item 3 builds
      both in from the start against the shared fixture.)_
      Dot-path field names (`"metadata.tags"`) and a `$contains` operator (array/JSON containment), implemented where
      the backend supports it and rejected per the A-3 convention elsewhere. Supabase: dot-paths map to PostgREST
      `->`/`->>` arrow syntax, `$contains` to `cs` (`supabase-repository.ts` translator); `@mantlejs/mongodb` (Phase 4
      item 3) supports both natively — build them in from the start; Knex: `$contains` via `whereJsonSupersetOf` on pg,
      rejected on other clients; memory: implement both (it's the test reference). All other adapters: `BadRequest` via
      `assertOperators`.
      **Accept:** shared spec fixture run against memory + supabase (mocked) proving dot-path equality and `$contains`
      agree; unsupported adapters throw naming the operator.

- [x] **D-8. Rename `GraphRepository.cypher()` to `raw()` (pre-release API fix)**
      _(Resolved: clean rename in the core interface and `Neo4jRepository`, no alias. The internal
      `WhereResult.cypher` field became `clause` so no `cypher` identifier remains in either package's
      source; neo4j README and the FeathersJS parity doc updated.)_
      The core graph contract (`packages/mantle/src/lib/types.ts:97-98`) names its escape hatch `cypher()` — a
      Neo4j-specific term leaked into the adapter-neutral interface. Any future graph adapter (ArangoDB/AQL, Neptune/
      Gremlin) would implement a method whose name is wrong. Rename to
      `raw<R = T>(query: string, params?: Record<string, unknown>): Promise<R[]>` in the interface and in
      `Neo4jRepository` (`packages/neo4j/src/lib/neo4j-repository.ts`). No deprecation alias — nothing is published
      yet, so make the clean cut now; after the 0.1.0 release this becomes a semver-major change. Update the neo4j
      README examples.
      **Accept:** no `cypher` identifier remains in `packages/mantle` or `packages/neo4j` source; existing neo4j specs
      pass against `raw()`.

- [x] **D-9. Mark Supabase change-feed re-emissions as external (E7)**
      _(Resolved: change-feed emissions now carry `{ external: true }` — the flag is typed as
      `ServiceParams.external` in core — and the supabase README documents both the marker and the
      UPDATE→`patched` rationale.)_
      `packages/supabase/src/lib/supabase-repository.ts:108-114` re-emits DB changes as `service:event` with `{}`
      params, indistinguishable from hook-pipeline events. Emit `{ external: true }` as the params argument instead, and
      document in the supabase README why external `UPDATE`s map to `"patched"` (never `"updated"`).
      **Accept:** spec asserting the emission's params carry `external: true`; README section present.

---

## Deferred to Phase 5 (do not start now)

`@mantlejs/mcp`, `KnexTimeSeriesRepository` (Q9), `@mantlejs/arangodb` (Q10) — tracked in the
[Phase 5 Checklist](./mantle-js-phase-5-checklist.md).

---

## Reference

- [AI-First Architecture Review](./ai-first-architecture-review.md) — findings, evidence, and rationale
- [Phase 4 Checklist](./mantle-js-phase-4-checklist.md) — B-1 blocks item 1; B-2 blocks items 1 and 4; D-1/D-2 feed item 4
- [Phase 4 TDD](./mantle-js-phase4-tdd.md) — Tier B designs go here before implementation
- [Phase 5 Checklist](./mantle-js-phase-5-checklist.md) — deferred items (`@mantlejs/mcp`, Q9, Q10)
