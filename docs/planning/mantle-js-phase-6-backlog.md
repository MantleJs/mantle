# Mantle JS — Phase 6 Backlog

Items earmarked for Phase 6. This is a backlog, not a checklist — a Phase 6 PRD must be written before these
become actionable checklist items. Items 1–2 were moved here from the [Phase 5 checklist](./mantle-js-phase-5-checklist.md)
(2026-07 scope decision: Phase 5 focuses on release readiness — `@mantlejs/mcp`, Apple/Microsoft auth, logging
hardening, the canonical example, and the first npm release).

---

## 1. `KnexTimeSeriesRepository` (Q9) *(moved from Phase 5; review §2.2 — time-series)*

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

## 2. `@mantlejs/arangodb` — multi-model adapter (Q10) *(moved from Phase 5; review §2.2 — polyglot)*

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

## 3. Mantle website

Public marketing + documentation site for mantlejs.org (domain TBD): landing page, docs generated from package
READMEs + the planning/decision docs, versioned API reference from the emitted `.d.ts`, guides (getting started,
architecture, adapters, auth, deployment on Cloud Run), and the canonical example (Phase 5) presented as a live
demo/tutorial. Site stack is a Phase 6 PRD decision (candidates: Astro Starlight, Docusaurus, Next.js — noting
the "no SSR in Mantle itself" rule applies to the framework, not its website).

## 4. Mantle UI library (Supabase-UI-style)

A component library in the spirit of [Supabase UI](https://supabase.com/ui): prebuilt, copy-pasteable React
blocks wired to Mantle out of the box — auth forms (local + OAuth buttons for Google/GitHub/Facebook/Apple/
Microsoft/LinkedIn), file upload dropzones bound to `@mantlejs/storage`, realtime lists/tables over `@mantlejs/react`
hooks, pagination controls understanding `Paginated<T>`. Built on shadcn/ui primitives (same foundation as
Supabase UI) so the Phase 5 canonical example — which uses shadcn/ui directly — can be retrofitted as the
library's first consumer. Decision (Phase 5 planning): deliberately deferred to Phase 6 so the first npm release
is not gated on UI work; distribution model (npm package vs shadcn-style registry) is a Phase 6 PRD question.

## 5. Deferred from Phase 4 non-goals

Carried from the [Phase 4 PRD](./mantle-js-phase-4-prd.md#goals--non-goals) non-goals list, still unscheduled —
pull into the Phase 6 PRD or later phases as demand dictates:

- GraphQL transport
- Rate limiting plugin
- Multi-tenancy primitives
- Vue 3 composables (and/or Svelte, SolidJS, Angular bindings — community candidates)
- Multi-cloud adapters: AWS Neptune, Azure Cosmos DB

---

## Reference

- [Phase 5 PRD](./mantle-js-phase-5-prd.md)
- [Phase 5 Checklist](./mantle-js-phase-5-checklist.md)
- [AI-First Architecture Review](./ai-first-architecture-review.md) — rationale for items 1–2 (§2.2, §8 backlog)
- [Phase 4 PRD](./mantle-js-phase-4-prd.md) — non-goals carried into item 5
