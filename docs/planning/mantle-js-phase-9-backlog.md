# Mantle JS — Phase 9 Backlog

Items earmarked for Phase 9 or later. This is a backlog, not a checklist. A Phase 9 PRD must be written before
these become actionable checklist items.

**Origin (2026-10-12):** carried forward from the [Phase 8 backlog](./mantle-js-phase-8-backlog.md) when the
[Phase 8 PRD](./mantle-js-phase-8-prd.md) was written. Phase 8 took multi-tenancy (old item 3) plus new
production-API, MCP, open-source readiness, and content work. See the Phase 8 PRD's Decisions table, #2.

---

## 1. `KnexTimeSeriesRepository` (Q9)

Full spec: [Phase 7 backlog, item 1](./mantle-js-phase-7-backlog.md).

## 2. `@mantlejs/arangodb` — multi-model adapter (Q10)

Full spec: [Phase 7 backlog, item 2](./mantle-js-phase-7-backlog.md).

## 3. Still deferred from Phase 4 non-goals

- GraphQL transport
- Vue 3 composables (and/or Svelte, SolidJS, Angular bindings — community candidates)
- Multi-cloud adapters: AWS Neptune, Azure Cosmos DB

## 4. Deferred from the Phase 7 PRD's own non-goals

- A Radix/Base UI variant of the Mantle UI registry blocks
- Persistent or stateful MCP code-mode sandbox sessions, and network access from inside the sandbox
- `create-mantlejs` scaffold options for the UI registry (`--ui`) and code mode (`--mcp-code`)

## 5. Deferred from the Phase 8 PRD

- `Deprecation` (RFC 9745) and `Sunset` (RFC 8594) headers, plus API versioning guidance
- Signed outbound webhooks ([Standard Webhooks](https://www.standardwebhooks.com/))
- Sliding-window / GCRA rate-limit algorithms behind the `RateLimitStore` interface
- Schema-per-tenant and database-per-tenant isolation as shipped code
- MCP `tools/list_changed` dynamic tool loading (stateful sessions only)
- `428 Precondition Required` for `requireIfMatch`
- OpenChain (ISO/IEC 5230, ISO/IEC 18974) conformance
- ~~Making Problem Details the default error body~~ — done in Phase 8 item 6 (pre-1.0, no known users)
- Atomic `WriteOptions.where` on mongodb (filter), dynamodb (`ConditionExpression`), and supabase (`.eq()`) — today
  only memory and knex make `conditional()` writes atomic (Phase 8 Decision #10)
- `idempotencyKey` on `@mantlejs/react`'s `useCreate`/`usePatch`: a key fixed across TanStack Query's own retries but
  new per `mutate()` call (Phase 8 item 9)
