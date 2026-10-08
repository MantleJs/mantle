# Mantle JS — Phase 8 Backlog

Items earmarked for Phase 8 or later. This is a backlog, not a checklist. A Phase 8 PRD must be written before
these become actionable checklist items.

**Origin (2026-10-06):** carried forward from the [Phase 7 backlog](./mantle-js-phase-7-backlog.md) when the
[Phase 7 PRD](./mantle-js-phase-7-prd.md) was written. Phase 7 took the Mantle website and the Mantle UI library
(old items 3–4), plus MCP code mode (new). The items below weren't pulled forward because none of them serve
those three themes, and none has a current demand signal. See the Phase 7 PRD's Decisions table, #1. Full
specifications are unchanged from the Phase 7 backlog and are linked rather than duplicated, to avoid drift.

---

## 1. `KnexTimeSeriesRepository` (Q9)

TimescaleDB-backed time-series extension to `@mantlejs/knex`, following the `KnexVectorRepository` precedent.
Includes `timeBucket()`, `$between`, and `ensureHypertable()`. No new package.
Full spec: [Phase 7 backlog, item 1](./mantle-js-phase-7-backlog.md).

## 2. `@mantlejs/arangodb` — multi-model adapter (Q10)

New package implementing `Repository<T>` + `GraphRepository<T>` over ArangoDB (AQL translation, `raw()` escape
hatch, `describe()` reporting both capability sets).
Full spec: [Phase 7 backlog, item 2](./mantle-js-phase-7-backlog.md).

## 3. Deferred from Phase 4 non-goals

Originally deferred in the [Phase 4 PRD](./mantle-js-phase-4-prd.md#goals--non-goals) and still unscheduled:

- GraphQL transport
- Rate limiting plugin
- Multi-tenancy primitives
- Vue 3 composables (and/or Svelte, SolidJS, Angular bindings — community candidates)
- Multi-cloud adapters: AWS Neptune, Azure Cosmos DB

## 4. Deferred from the Phase 7 PRD's own non-goals

- A Radix/Base UI variant of the Mantle UI registry blocks
- Persistent or stateful MCP code-mode sandbox sessions, and network access from inside the sandbox
- `create-mantlejs` scaffold options for the UI registry (`--ui`) and code mode (`--mcp-code`)

---

## Reference

- [Phase 7 PRD](./mantle-js-phase-7-prd.md)
- [Phase 7 Backlog](./mantle-js-phase-7-backlog.md) — full specs for items 1–2
- [Phase 4 PRD](./mantle-js-phase-4-prd.md) — non-goals carried into item 3
