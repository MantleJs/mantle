# Mantle JS — Phase 5 Implementation Checklist

Items deferred from the [AI-First Architecture Review](./ai-first-architecture-review.md) (§4, §8 backlog).

> **Scope note:** this checklist covers only the review-derived items. The broader Phase 5 scope earmarked in the
> [Phase 4 PRD](./mantle-js-phase-4-prd.md) non-goals — GraphQL transport, rate limiting plugin, multi-tenancy
> primitives, Vue 3 composables, multi-cloud adapters (Neptune, Cosmos DB) — needs a Phase 5 PRD before checklist
> items can be written; add them here once that PRD exists.

All three items depend on Phase 4 groundwork: item 1 consumes `Repository.describe()` / `ServiceHandle.describe()`
(remediation checklist D-1/D-2) and the `@mantlejs/schema` integration; items 2 and 3 follow established in-repo
precedents cited inline.

---

- [ ] **1. Implement `@mantlejs/mcp` — expose Mantle services as MCP tools** *(review §6.3)*
  New package, depends only on `@mantlejs/mantle` (consistent with the dependency matrix). `mcp(options)` configure
  plugin builds an MCP server from the app's registered services: each service method becomes one tool
  (`users_find`, `users_get`, `users_create`, …), generated from `ServiceHandle.describe()` — input schemas from the
  service's TypeBox schema plus a `QueryParams` schema constrained to `describe().capabilities.operators` (so an
  agent is never offered an operator the adapter rejects), tool descriptions from the descriptor, service events
  optionally exposed as MCP resources. **Every call routes through `service.dispatch()`** so the full hook pipeline
  (auth, validation, events) applies — no bypass path. Options: `services?: string[]` allowlist (default: all),
  `transport: "stdio" | "http"` (streamable HTTP mounted on the app's transport via the `http:router` contract from
  remediation item C-1). Auth for HTTP transport: reuse `authenticate("jwt")` semantics — bearer token on the MCP
  request populates `params.user` for hooks. Errors return the `MantleError.toJSON()` shape including `hint`
  (remediation C-5) as MCP tool errors, not protocol errors.
  **Accept:** spec: an app with two services (one schema'd `RepositoryService` over memory, one custom) lists the
  expected tool set with correct input schemas; a `find` tool call with an unsupported operator returns a tool error
  naming the operator; a hook that throws `Forbidden` surfaces as a tool error, proving the pipeline ran.

- [ ] **2. Implement `KnexTimeSeriesRepository` (Q9)** *(review §2.2 — time-series)*
  Extend `@mantlejs/knex` following the `KnexVectorRepository` precedent
  (`packages/knex/src/lib/knex-vector-repository.ts`: specialized repository extending `KnexRepository`, asserts the
  pg client, no new package). Target TimescaleDB on PostgreSQL: subclasses declare `readonly timeColumn: string`
  (default `"createdAt"`). Add: `timeBucket(interval: string, aggregations: Record<string, "avg" | "sum" | "min" | "max" | "count">, params?: QueryParams & { range?: { from: Date; to: Date } }): Promise<Array<Record<string, unknown>>>`
  wrapping Timescale's `time_bucket()`; a `$between: [from, to]` shorthand for the time column (sugar over
  `$gte`/`$lte`, accepted by `assertOperators` for this repository only); and an `ensureHypertable()` helper for
  migrations (calls `create_hypertable`, idempotent). Non-pg clients throw `GeneralError` from all time-series
  methods, mirroring `assertPostgres()` in the vector repository. Standard `Repository<T>` methods inherit
  unchanged. Document the "Timescale-first, native TSDB adapters deferred until demand" decision in the package
  README.
  **Accept:** unit specs for the generated `time_bucket` SQL (interval, aggregation map, range filter, where
  passthrough); spec that sqlite client throws on `timeBucket`; `$between` spec expanding to the right bounds.

- [ ] **3. Implement `@mantlejs/arangodb` — multi-model adapter (Q10)** *(review §2.2 — polyglot)*
  New package depending on `@mantlejs/mantle` + `arangojs`. One package, two core interfaces — the in-repo precedent
  is `KnexVectorRepository` implementing `Repository<T>` + `VectorRepository<T>` in one class. `arangodb(options)`
  configure plugin stores an `arangojs` `Database` on the app. `ArangoRepository<T, D>` implements `Repository<T, D>`
  over a document collection (AQL translation of `QueryParams` — full operator set including `$like` via AQL
  `LIKE`, fail-loud via `assertOperators` for anything else; `_key` ↔ `id` mapping at the boundary) **and**
  `GraphRepository<T>` over named graphs (`createRelationship` → edge collection insert, `traverse` → AQL graph
  traversal with depth, and the `raw()` escape hatch — renamed from `cypher()` pre-release by remediation item D-8 —
  executes AQL with bind vars, exactly as the Neo4j implementation executes Cypher). Implement
  `describe()` (D-1) reporting both capability sets. Update the dependency matrix in `CLAUDE.md` and the root README
  packages table.
  **Accept:** operator-translation unit specs (shared fixture semantics matching `@mantlejs/memory` results);
  traversal spec against a mocked/`arangojs`-stubbed graph; `describe()` reports document + graph capabilities;
  `nx run-many -t build,test,lint` green.

---

## Reference

- [AI-First Architecture Review](./ai-first-architecture-review.md) — rationale (§2.2, §6.3, §8 backlog)
- [AI-First Review Remediation Checklist](./ai-first-review-checklist.md) — Phase 4 prerequisites (D-1, D-2, C-1, C-5)
- [Phase 4 Checklist](./mantle-js-phase-4-checklist.md)
