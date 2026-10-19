# Mantle JS — Phase 8 Implementation Checklist

Work through these in order. Each item maps to a spec in the [Phase 8 PRD](./mantle-js-phase-8-prd.md). Phase 8
runs in four stages:

1. Foundations & spikes (items 1–4). Item 5's quick parts can run at any time.
2. Build: production API (items 6–11), agent-native MCP (items 12–15), and multi-tenancy (items 16–18). The three
   tracks are independent, except that items 17's rate-limit and audit integrations wait for item 8.
3. Brand, site & content (items 19–21)
4. Release (item 22)

> **Note (2026-10-12):** scope is the production-grade API set (rate limiting, idempotency, Problem Details,
> conditional requests, tracing, health), agent-native MCP (layered mode, annotations, idempotency passthrough,
> test client), multi-tenancy (from the Phase 8 backlog's item 3), open-source readiness & brand, and a content
> process. Everything else moves to the [Phase 9 backlog](./mantle-js-phase-9-backlog.md). See the PRD's
> Decisions table, #2.

---

## Stage 1 — Foundations & spikes

- [ ] **1. Foundations: `context.http`, `context.event`, `params.ip`, request ID** _(PRD spec 1)_
  - `HookContext.http` (status + headers), applied by express/koa/http on success and error paths; 304/204 send
    no body; headers set before an error survive it.
  - `context.event = null` suppresses the `service:event` emission.
  - `MantleError.headers`, merged over `context.http.headers`, not serialized.
  - `PreconditionFailed` (412) error class; `CLAUDE.md` error list updated.
  - `params.ip` with a `trustProxy` transport option (default off).
  - One shared request-ID implementation replacing the three `x-correlation-id` middlewares; `X-Request-Id` in,
    out, and in `withContext()`. `X-Correlation-Id` accepted for one release.
  - CORS `exposedHeaders` defaults extended.

  **Accept:** one shared transport conformance table run by all three HTTP transports; socket.io and MCP specs
  showing `context.http.headers` is ignored; event-suppression spec in core.

- [ ] **2. Spike: duplicate-id `Conflict` across adapters** _(PRD spec 4, Decision #6)_
      For each `Repository<T>` adapter, does `save()` with an existing primary key throw `Conflict` (atomically)?
      **Accept:** per-adapter findings recorded in Decision #6. Adapters that don't are either fixed (if it's a
      bug) or documented as unsupported idempotency stores.

- [ ] **3. Spike: MCP SDK mechanics** _(PRD specs 8–11)_
      Against `@modelcontextprotocol/sdk` ^1.29: tool annotations on `registerTool`, reading `_meta` from a
      `tools/call` request, and the in-memory transport pair for `createMcpTestClient()`.
      **Accept:** findings recorded as a new Decisions row; PRD specs 9–11 amended if anything is contradicted.

- [ ] **4. Spike: Postgres row-level security via knex** _(PRD spec 13)_
      `SET LOCAL app.tenant_id` inside `withTransaction()`, an RLS policy reading `current_setting`, and how it
      interacts with connection pooling.
      **Accept:** findings recorded in Decision #7; the recipe either confirmed for spec 13 or dropped.

- [ ] **5. License, community files, metadata** _(PRD spec 15)_
  - [x] Root `LICENSE` (MIT) + a copy in all 40 `packages/*`. **Done (2026-10-12):** verified in
        `npm pack --dry-run` for `@mantlejs/audit`.
  - [x] Every package's `homepage` → `https://mantlejs.com/packages/<name>/`. **Done (2026-10-18):** all 40
        pages verified live (HTTP 200) before the change.
  - [ ] `tools/check-package-metadata.mjs` (LICENSE present, `license: MIT`, homepage) in CI.
  - [ ] `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue templates, PR template.
  - [ ] Enable GitHub private vulnerability reporting.
  - [ ] _(manual)_ GitHub repo description, website, and topics.
  - [ ] RFC 3339 date-serialization audit; conventions table note.

  **Accept:** CI guard fails on a package with its `LICENSE` removed; community files render on GitHub's
  community profile page as complete.

---

## Stage 2 — Build

### Production-grade API

- [ ] **6. Problem Details (RFC 9457)** _(PRD spec 2)_
      Transport `errors: "mantle" | "problem+json"` option, the mapping, `@mantlejs/client` parsing both shapes,
      one docs page per error class at `mantlejs.com/errors/<name>`.
      **Accept:** conformance rows for both shapes; client specs; docs pages live.

- [ ] **7. Conditional requests** _(PRD spec 5)_
      `conditional()` hook in `@mantlejs/mantle`: ETag on `get`, 304 on `If-None-Match`, 412 on failed
      `If-Match`, `versionField`, `requireIfMatch`.
      **Accept:** branch specs on memory + knex/sqlite; transport rows for 304/412; Decision #10 filled in.

- [ ] **8. `@mantlejs/ratelimit`** _(PRD spec 3)_
      Generate with the Nx library generator. `rateLimit()`, `memoryStore()`, `redisStore()`, key functions,
      draft-11 headers, `Retry-After`. Add to the `experimental` release group, `CLAUDE.md` table, and
      `dependencyMatrix`.
      **Accept:** store specs (Redis via testcontainers); header golden specs; multi-policy spec; MCP agent-keyed
      spec; README.

- [ ] **9. `@mantlejs/idempotency`** _(PRD spec 4; after items 1–2)_
      `idempotency()` returning `{ before, after, error }`, fingerprinting, `required`, TTL, replay with
      `Idempotent-Replayed`, event suppression. `@mantlejs/client` `idempotencyKey` option.
      **Accept:** every flow branch on memory; concurrency spec (parallel same-key → one 409); HTTP and MCP
      end-to-end; client specs; README.

- [ ] **10. Tracing** _(PRD spec 6)_
      `traceparent`/`tracestate` parsing in core, logger fields, new `@mantlejs/otel` package.
      **Accept:** parsing specs; in-memory exporter spec for span names, parentage, and error status.

- [ ] **11. Health checks** _(PRD spec 7)_
      `health()` plugin, `ping?()` on `knex`, `mongodb`, `dynamodb`, `supabase`; deployment guide updated.
      **Accept:** specs on all three HTTP transports; per-adapter `ping` specs.

### Agent-native MCP

- [ ] **12. Layered tool mode** _(PRD spec 8)_
      `mode: "layered"` with `list_services`, `describe_service`, `call`.
      **Accept:** per-tool specs; scope-filter spec; three-way equivalence spec; eager vs layered `tools/list` size
      in the README.

- [ ] **13. Tool annotations** _(PRD spec 9)_
      **Accept:** table-driven spec; override spec; code-mode declarations snapshot updated.

- [ ] **14. Idempotency-key passthrough** _(PRD spec 10; after item 9)_
      **Accept:** agent retries a `create` with the same key → one record, replayed result.

- [ ] **15. `createMcpTestClient()`** _(PRD spec 11)_
      **Accept:** adopted by existing `mcp`/`mcp-code` specs; documented in the agents guide.

### Multi-tenancy

- [ ] **16. `@mantlejs/tenancy` core** _(PRD spec 12)_
      `resolveTenant()` with the resolvers, `tenantScope()`, `assertTenantScoped()`. Package wiring as in item 8.
      **Accept:** unit specs per method branch; the item 18 suite.

- [ ] **17. Tenant-aware realtime, rate limits, audit, RLS recipe** _(PRD spec 13; after items 4 and 8)_
      **Accept:** socket.io isolation spec; `@mantlejs/sync` cross-instance spec; `byTenant()` spec; audit spec;
      RLS recipe in the guide (if item 4 confirmed it).

- [ ] **18. Cross-tenant leak conformance suite** _(PRD spec 14)_
      **Accept:** passes on memory, knex/sqlite, knex/Postgres; translator-level specs for the other adapters.

---

## Stage 3 — Brand, site & content

- [ ] **19. Supply chain** _(PRD spec 16)_
      SPDX SBOM step in `release-publish.yml`; OpenSSF Scorecard action + README badge + cheap fixes;
      `docs/security/asvs-l1.md`.
      **Accept:** a dry-run release produces SBOMs; Scorecard runs on `main`; ASVS gaps triaged.

- [ ] **20. Logo v1 + brand tokens** _(PRD spec 17)_
      SVG mark, favicon set, OG image, org avatar PNG; tokens in `global.css` mapped to Starlight and the
      registry demos; README header; knowledge-base favicon.
      **Accept:** WCAG AA contrast in light and dark; one source for every logo usage.

- [ ] **21. Blog + content process** _(PRD spec 18)_
      `starlight-blog` with RSS; `docs/marketing/content-process.md`; three drafted pieces; the guides for
      every new Phase 8 package on the site.
      **Accept:** blog live with the first post; process doc reviewed.

---

## Stage 4 — Release

- [ ] **22. Release + post-release verification** _(PRD spec 19)_
      Stable `0.4.0`, experimental `0.4.0-experimental` (with the four new packages), SBOMs on the GitHub release,
      site deployed, post-release install check of every new package.
