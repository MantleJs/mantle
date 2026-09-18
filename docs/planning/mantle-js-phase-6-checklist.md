# Mantle JS — Phase 6 Implementation Checklist

Work through these in order. Each item maps to a spec in the [Phase 6 PRD](./mantle-js-phase-6-prd.md), which
itself is grounded in [`BAAS-READINESS.md`](./BAAS-READINESS.md). Phase 6 runs in three stages, strictly
ordered: harden what's released (items 1–4) → extend with three targeted additions plus one new OAuth
strategy (items 5–8) → release (item 9).

> **Note (2026-09-15):** this phase's PRD deferred `KnexTimeSeriesRepository`, `@mantlejs/arangodb`, the
> Mantle website, and the Mantle UI library — all four moved to the old Phase 6 backlog previously — into a
> new [Phase 7 backlog](./mantle-js-phase-7-backlog.md). `BAAS-READINESS.md` argues explicitly against adding
> package surface before hardening what's already shipped; see the PRD's Decisions table, #1.
>
> **Update (2026-09-17):** `@mantlejs/auth-twitter` (item 8) added directly to this phase's scope, despite
> `BAAS-READINESS.md` §1.4 explicitly recommending against more OAuth strategies — see the PRD's Decisions
> table, #7.

---

## Stage 1 — Harden

- [ ] **1. Adapter conformance matrix** *(PRD spec 1)*
  For each of the two documented `QueryParams` gaps (`$contains` on knex-mysql/knex-sqlite/knex-mssql/neo4j/
  pinecone/qdrant; nested dot-paths on everything except memory/supabase/mongodb): per adapter, either extend
  the operator where semantically possible, or formalize the absence in `describe().capabilities.operators`.
  Update `CLAUDE.md`'s operator table to match reality exactly once done — no adapter should advertise a
  capability `assertOperators` doesn't actually enforce, or enforce one it doesn't advertise.
  **Accept:** a written decision (extended, or formalized-absent) recorded in the PRD's Decisions table for
  every adapter × gap pair; extended adapters pass the shared `NESTED_QUERY_CASES`/`$contains` conformance
  fixtures from `@mantlejs/mantle`; `describe().capabilities.operators` cross-checked against `assertOperators`
  for every stable and to-be-promoted adapter — zero drift.

- [ ] **2. `@mantlejs/mcp` — verify hook-pipeline equivalence** *(PRD spec 3)*
  Manifest source, raw-query absence, and expose-map granularity are already confirmed by direct inspection
  (see PRD spec 3) — no code changes expected for those three. The one open question needing a spec: does an
  MCP-originated call and an HTTP-originated call against the same service run through *identical*
  `authenticate`/`authorize` hooks, differing only in `HookContext.provider`?
  **Accept:** a spec registering one service with an `authenticate`+`authorize` hook chain, calling it once
  via HTTP and once via MCP with equivalent credentials, asserting identical accept/reject behavior.

- [ ] **3. Auth hardening under concurrency** *(PRD spec 4)*
  No new OAuth strategies. Specs proving, against `@mantlejs/auth-redis` specifically: concurrent refresh
  requests against the same token don't issue two valid successors; two app instances sharing one Redis
  correctly see each other's refresh-token/OAuth-state writes including TTL/cleanup; concurrent OAuth flows
  from the same user (e.g. two tabs) don't cross-contaminate PKCE verifier/state pairs.
  **Accept:** all three specs green; existing single-instance auth specs unchanged; any bug the specs surface
  fixed before moving on (don't just document a known race — this is hardening, the point is to close gaps).

- [ ] **4. Promote experimental adapters to stable** *(PRD — Adapter Promotion Plan)*
  Per package, per the plan's table:
  - `pinecone`, `qdrant`: re-run Phase 5 item 9's review process (README-vs-code accuracy, flagship example
    runs clean, branch coverage) to confirm no new defects since the fixes already found in place during this
    PRD's research — don't assume the clean bill of health still holds untested
  - `neo4j`, `mongodb`: same review process, first time through (Phase 5 didn't call out specific defects for
    these two, but they were never individually reviewed either)
  - `dynamodb`: targeted branch-coverage work (63.19% today) closing the gap toward the `openapi` bar
    (100%/93.5%) — or an explicit, recorded decision to accept a lower bar this time, not a default
  - For every package that clears its bar: merge into `nx.json`'s `stable` group; version jumps directly to
    `stable`'s current version at merge time (fixed-group semantics — same mechanism `auth-apple`/
    `-microsoft`/`-linkedin` used joining from a standing start in Phase 5); run
    `tools/bump-peer-ranges.mjs` for the group; audit `examples/*/package.json` for exact (non-caret) pins on
    any promoted package before ever running `nx release version` — this exact bug (Phase 5 item 12) broke a
    prior release and would recur silently otherwise
  - A package that doesn't clear its bar stays experimental — promotion is per-package, not group-wide
  **Accept:** each promoted package's comparison table entry updated with final numbers; `nx release version
  --groups=stable --dry-run` shows the expected project list with no cross-group leakage; any package staying
  experimental has a recorded reason, not silence.

## Stage 2 — Extend

- [ ] **5. Agent identity + capability scopes** *(PRD spec 10)*
  `AgentPrincipal` (short-lived, capability-scoped by `path`+`method`, revocable, carrying a
  `delegatingUserId`) minted by a new token-issuance flow in `@mantlejs/auth`. `authorizeAgent()` hook checking
  the capability list against `HookContext.path`+`HookContext.method`, deny-by-default, reusing
  `@mantlejs/mcp`'s existing expose-map denial logic rather than a parallel implementation (PRD Decision #4).
  `HookContext` gains an additive `agent?: { id, scope, delegatingUserId }` — no breaking change to
  `params.user`.
  **Accept:** token-issuance spec (capability list round-trips, expiry enforced); `authorizeAgent()` spec
  (in-scope passes, out-of-scope → `Forbidden` in the same shape the expose map already produces);
  `HookContext.agent` populated correctly through `@mantlejs/mcp`'s existing dispatch path end-to-end; a spec
  proving an agent token is rejected on any route with no `authorizeAgent()` hook attached (opt-in per route,
  never a silent global bypass of `authenticate()`).

- [ ] **6. Audit hook — `@mantlejs/audit`** *(PRD spec 11)*
  New package. Hook attachable to `before`/`after`/`error`, recording `{ principal, agentId?, path, method,
  params, result summary, timestamp }` to a pluggable sink — the sink is a `Repository<T>` the deployment
  already has, no new storage concept. When the call is agent-originated (item 5), the entry additionally
  carries the `AgentPrincipal`'s scope and delegating user.
  **Accept:** hook records a correct entry for a plain user call and an agent call (agent entry has the extra
  fields, user entry doesn't); sink proven against `@mantlejs/memory` and at least one real adapter; a sink
  write failure doesn't fail the primary operation (matches spec 7's non-fatal-on-failure rule, applied here
  even though this isn't a cross-adapter *write* per se — same failure-isolation principle); README with a
  quick start.

- [ ] **7. Auto-embed-on-write hook + cross-adapter write-consistency pattern** *(PRD specs 2 and 12)*
  **First:** spike whether `pinecone`, `qdrant`, or `MongoVectorRepository` already generate embeddings from
  source text, or whether the caller always supplies a ready-made vector. Record the finding in the PRD's
  Decisions table before writing any hook code — if adapters differ on this, that's itself a new entry for
  item 1's conformance matrix.
  **If the caller must supply the vector (expected):** build `@mantlejs/embeddings` — a hook (`after: {
  create: [embed({ field, provider })] }`) calling a pluggable embedding provider and upserting into the
  configured vector adapter. This is also where the cross-adapter write-consistency pattern (PRD spec 2) gets
  formalized for real, using this hook as the concrete case: idempotent upsert keyed on the source record's
  id, safe to retry, non-fatal failure. Document the pattern in `CLAUDE.md`'s "Services with multiple
  repositories" section once proven here.
  **Accept:** spike findings recorded regardless of outcome; if built — idempotency spec (re-running the hook
  for the same source id doesn't duplicate the vector), a failure-injection spec (embedding-provider failure
  doesn't roll back or block the primary write), `CLAUDE.md` pattern documented, and
  `examples/knowledge-base`'s existing manual embed-on-create call in `articles-service.ts` reviewed against
  the new hook — replaced with it if the hook is a strict improvement, left alone with a documented reason if
  not.

- [ ] **8. Implement `@mantlejs/auth-twitter`** *(PRD spec 13)*
  New package over `@mantlejs/auth-oauth` + Arctic's `Twitter` provider class. PKCE on (Arctic's
  `createAuthorizationURL` takes a `codeVerifier`) — same posture as `auth-google`/`auth-microsoft`, unlike
  the no-PKCE strategies. Standard GET callback. Profile from X's API v2 `users/me` endpoint — confirm the
  exact path, required scopes, and response shape against X's current developer docs before implementing,
  don't assume the PRD's spec is exact (this platform's API/branding moves faster than the other six
  providers already shipped). `entityIdField` default `"twitterId"`; config is plain `OAuthPluginConfig`.
  Update `CLAUDE.md` dependency matrix + root README + `packages/cli/src/lib/versions.ts`'s `--auth` choice
  list (an eighth strategy alongside the existing seven).
  **Accept:** specs mirroring `google-strategy.spec.ts` (PKCE URL construction with `codeVerifier`; exchange
  failure; userinfo normalization with/without optional fields; missing user-id field → `GeneralError`);
  `create-mantlejs` e2e-scaffold smoke test still green with `--auth twitter` added as a choice.

## Stage 3 — Release

- [ ] **9. Version and publish**
  Finalize tier placement: `@mantlejs/audit` and `@mantlejs/embeddings` (if built) default to
  `0.1.0-experimental` per the standing rule (PRD Decision #3) unless this stage's review finds a specific
  reason to except one, using the same process Phase 5 used for `openapi`. `@mantlejs/auth-twitter` joins
  `stable` directly (PRD Decision #7) — same mechanism as `auth-apple`/`auth-microsoft`/`auth-linkedin`
  joining `stable` from a standing start in Phase 5. Decide and record whether an empty/near-empty
  `experimental` `nx.json` group (once adapters promote out of it) is removed or kept for future use (PRD
  Release Plan). Then: `nx release version` for both groups (peer ranges bumped first, per
  `docs/releasing.md`), Verdaccio rehearsal, real publish via `release-publish.yml`, post-release verification
  (fresh installs, a scaffold/example re-pointed at registry versions) — the same process Phase 5's item 12
  proved out, reused as-is.
  **Accept:** every package from this phase resolvable and importable from the public registry at its correct
  tier; `nx run-many -t build,test,lint,typecheck` green across the workspace including all new packages;
  GitHub release notes published for whichever tags this phase's version bump produces.

---

## Reference

- [Phase 6 PRD](./mantle-js-phase-6-prd.md)
- [`BAAS-READINESS.md`](./BAAS-READINESS.md)
- [Phase 7 Backlog](./mantle-js-phase-7-backlog.md) — items moved out of this checklist
- [Phase 5 Checklist](./mantle-js-phase-5-checklist.md) — item 9 (promotion-bar precedent), item 12 (release
  pipeline, the exact-pin bug this phase's item 4 checks for proactively)
- [`docs/releasing.md`](../releasing.md) — release runbook this phase's item 9 reuses
