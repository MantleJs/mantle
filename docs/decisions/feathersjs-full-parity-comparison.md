# Mantle JS vs FeathersJS: Full Functional Parity

Framework-level comparison across every major FeathersJS capability, as of Phase 4 planning. Package-specific
comparisons already exist for [Socket.IO](./socketio-comparison.md), [OAuth strategies](./oauth-strategy-comparison.md),
and the [CLI](./cli-comparison.md) — this document rolls those up alongside the areas not yet covered anywhere else
(database breadth, client/batch, OpenAPI, file storage) to answer one question: **is there anything a FeathersJS app
can do that a Mantle app can't?**

---

## Summary table

| Capability | FeathersJS | Mantle (Phase 1–3, shipped) | Mantle (Phase 4 plan) |
|---|---|---|---|
| Services + hooks | ✅ class-based hooks | ✅ pure-function hooks only | — |
| REST transport | Express | ✅ Express, Koa, plain HTTP | — |
| Real-time transport | Socket.io, Primus | ✅ Socket.io, with channels | — |
| Cross-instance real-time sync | `@feathersjs/sync` (Redis) | ✅ `@mantlejs/sync` (Redis, DragonflyDB, Supabase Realtime) | — |
| Authentication | JWT + local + OAuth (Passport-based) | ✅ JWT + local (Argon2id) + OAuth (Google, GitHub, Facebook, no Passport) | — |
| Database adapters | Knex, Mongoose, MongoDB native, Objection, Sequelize | ✅ Knex (pg/mysql/sqlite/mssql), DynamoDB, Supabase | ➕ MongoDB (Atlas) |
| Vector database support | ❌ none | ✅ Pinecone, Qdrant, pgvector | — |
| Graph database support | ❌ none | ✅ Neo4j (`GraphRepository<T>`, raw `cypher()` escape hatch) | — |
| File uploads | `feathers-blob` / community | ✅ `@mantlejs/storage` (local, S3, GCS) — **write path only** | ➕ retrieve/delete/signed URLs |
| Client SDK | `@feathersjs/client` (REST + Socket.io) | 🔶 Planned | ➕ `@mantlejs/client` |
| Framework-specific hooks (React/Vue) | community (`feathers-vuex`, etc.) | 🔶 Planned | ➕ `@mantlejs/react` (TanStack Query) |
| CLI generator | `@feathersjs/cli` | ✅ `@mantlejs/cli`, `create-mantle` — see [cli-comparison.md](./cli-comparison.md) | — |
| Batch requests | `feathers-batch` (community plugin) | ❌ none | ➕ server batch endpoint + client-side call coalescing |
| OpenAPI/Swagger generation | `feathers-swagger` (community plugin) | ❌ none | ➕ `@mantlejs/openapi` |
| CORS | Express `cors` middleware, user-wired | ❌ not wired into any transport | ➕ built into `express`/`koa`/`http` configure options |
| Rate limiting | community (`express-rate-limit` wiring) | ❌ none | Non-goal — Phase 5 |
| Multi-tenancy primitives | community pattern, no core support | ❌ none | Non-goal — Phase 5 |
| GraphQL transport | community (`feathers-graphql`) | ❌ none | Non-goal — Phase 5 |
| Pagination | ✅ `$limit`/`$skip`, `Paginated<T>` | ✅ `limit`/`skip`, `Paginated<T>` | — |
| Schema validation | `@feathersjs/schema` (TypeBox) | ✅ `@mantlejs/schema` (TypeBox) | — |
| Error classes | `@feathersjs/errors` | ✅ typed `MantleError` subclasses | — |

Legend: ✅ shipped · 🔶 in progress this phase · ➕ new in this Phase 4 revision · ❌ gap

---

## Gaps closed by this Phase 4 revision

### 1. Database breadth — MongoDB

FeathersJS's most common production database adapters (`@feathersjs/mongodb`, `feathers-mongoose`) are both
MongoDB-backed. Mantle's Phase 3 ADR chose DynamoDB over MongoDB on the reasoning that MongoDB had "lost market
share to PostgreSQL JSONB and DynamoDB." That reasoning holds for green-field serverless deployments, but it
undercounts how many teams evaluating a FeathersJS migration are sitting on an existing MongoDB Atlas cluster —
for that audience, "no MongoDB adapter" is a hard blocker to trying Mantle at all. Phase 4 reverses the Phase 3
non-goal and adds `@mantlejs/mongodb` (official `mongodb` driver, not Mongoose — consistent with Mantle's
query-builder-not-ORM philosophy). See the Phase 4 PRD's package spec for interface details.

### 2. File storage — read path

`@mantlejs/storage`'s `StorageAdapter` interface currently only defines `store()`. There is no `retrieve()`,
`delete()`, or `getSignedUrl()` — a file can be written but never read back or removed through Mantle. FeathersJS
doesn't solve this natively either (`feathers-blob` is write-path-only too), but it's a real functional gap rather
than an intentional parity decision, and it blocks basic CRUD-complete file handling. Phase 4 extends
`StorageAdapter` with the read/delete surface across all three storage backends (disk, S3, GCS).

### 3. Batch requests

`feathers-batch` lets a client submit an array of service calls in one HTTP round trip. Mantle has no equivalent
today. This matters beyond Feathers parity: it's also the mechanism that makes Mantle efficient for AI agent
callers, which tend to fire many small related reads/writes per turn. Phase 4 adds both a server-side
`POST /batch` endpoint (dispatched through the same hook pipeline as individual calls — no auth/validation bypass)
and client-side call coalescing in `@mantlejs/client` for callers who don't want to construct batch payloads by
hand.

### 4. OpenAPI/Swagger generation

`feathers-swagger` is one of the most-installed FeathersJS community plugins — API documentation is a top ask for
any team shipping a service to external consumers. Mantle already has the ingredient FeathersJS's plugin has to
work around: `@mantlejs/schema` uses TypeBox, whose schemas *are* JSON Schema, so OpenAPI generation from
registered service schemas is a much shorter path than in Feathers (where schema definitions are looser and the
plugin does more inference work). Phase 4 adds `@mantlejs/openapi`.

### 5. CORS

Not a FeathersJS parity gap — Feathers apps wire `cors` into Express themselves — but a real gap in every Mantle
transport package today. No shipped transport (`express`, `koa`, `http`) has CORS wired in, which means every
Mantle app hitting a browser client from a different origin currently has to reach past the framework into raw
Express/Koa internals to fix it. Phase 4 adds it as a first-class, opt-in transport option.

---

## What Mantle already does better than FeathersJS

- **Database breadth beyond relational/document stores** — vector databases (Pinecone, Qdrant, pgvector) and graph
  databases (Neo4j) have no FeathersJS equivalent at all. This is a genuine differentiator, not a parity item.
- **OAuth without Passport.js** — smaller dependency tree, one consistent PKCE/state implementation shared across
  Google/GitHub/Facebook via `@mantlejs/auth-oauth`, vs. Feathers' per-strategy Passport wrapping.
- **Argon2id password hashing by default** — Feathers' local strategy defaults to bcrypt (72-byte input limit);
  Mantle uses the OWASP-recommended default from the start.
- **Function-based hooks only** — no class-based hook variant to support, simpler mental model, easier to test.
- **Real-time sync adapter breadth** — `@mantlejs/sync` supports Redis, DragonflyDB, and Supabase Realtime;
  `@feathersjs/sync` is Redis-only.
- See [socketio-comparison.md](./socketio-comparison.md) for the channels-level detail — Mantle's channel API is
  now feature-complete with Feathers', and cross-transport event emission (`'service:event'`) requires zero
  extra wiring compared to Feathers' per-transport channel configuration.

---

## Remaining intentional non-parity (not gaps — deferred by design)

| Item | Status | Reasoning |
|---|---|---|
| GraphQL transport | Phase 5 | Low signal vs. REST/real-time; revisit if requested |
| Rate limiting | Phase 5 | Belongs closer to the reverse proxy/gateway layer for most deployments; core primitive still useful, not urgent |
| Multi-tenancy primitives | Phase 5 | No consensus pattern to standardize on yet across adapters |
| AWS Neptune, Azure Cosmos DB, ArangoDB | Phase 5 | Multi-cloud graph/document breadth, not core-path blocking |
| Prisma / Mongoose adapters | Community | `Repository<T>` is a stable target interface; community can implement against it same as Mantle's own adapters do |
| Vue/Svelte/Solid/Angular framework bindings | Community or Phase 5 | React covers the largest share of the target audience first |

---

## Conclusion

After the Phase 4 additions above (MongoDB, upload read/delete, batch, OpenAPI, CORS), there is no remaining
capability a FeathersJS application has that a Mantle application cannot replicate — the gaps that are left
(GraphQL, rate limiting, multi-tenancy, additional cloud databases) are deliberate scope decisions for Phase 5 or
community ownership, not missing pieces of the Phase 1–4 core.
