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

- [x] **1. Adapter conformance matrix** *(PRD spec 1)*
  For each of the two documented `QueryParams` gaps (`$contains` on knex-mysql/knex-sqlite/knex-mssql/neo4j/
  pinecone/qdrant; nested dot-paths on everything except memory/supabase/mongodb): per adapter, either extend
  the operator where semantically possible, or formalize the absence in `describe().capabilities.operators`.
  Update `CLAUDE.md`'s operator table to match reality exactly once done — no adapter should advertise a
  capability `assertOperators` doesn't actually enforce, or enforce one it doesn't advertise.
  **Accept:** a written decision (extended, or formalized-absent) recorded in the PRD's Decisions table for
  every adapter × gap pair; extended adapters pass the shared `NESTED_QUERY_CASES`/`$contains` conformance
  fixtures from `@mantlejs/mantle`; `describe().capabilities.operators` cross-checked against `assertOperators`
  for every stable and to-be-promoted adapter — zero drift.
  **Done (2026-09-20):** added `nestedPaths: boolean` to `RepositoryCapabilities` (required, not
  optional — the whole point is a discoverable `false`, not a silent omission). Per adapter:
  - `knex` — **extended for real, on all four supported clients**, verified against live Docker
    containers (postgres:16, mysql:8, an emulated mssql:2022, and better-sqlite3) before shipping,
    not just asserted: dot-path fields via Knex's own cross-dialect `whereJsonPath`
    (`jsonb_path_query_first`/`JSON_EXTRACT`/`json_extract`/`JSON_VALUE`) for
    equality/$lt/$lte/$gt/$gte/$ne/$like/$notlike on pg/mysql/sqlite/mssql (`$ilike` pg-only — not
    standard SQL, unlike the others); `$contains` extended to MySQL via the same
    `whereJsonSupersetOf` knex already used for pg (`JSON_CONTAINS`, verified live); `$contains`
    combined with a dot-path field via hand-rolled raw SQL for pg/mysql only, also verified live.
    `$in`/`$nin`/null-checks on a dot-path field throw a clear `BadRequest` (no clean SQL
    translation exists — confirmed live: knex's own `whereJsonPath` operator validator rejects
    `"in"` outright). **Confirmed drift bug, fixed**: `describe()` was a static per-package
    constant advertising `$contains` unconditionally, even on clients that threw for it at query
    time — now client-aware, computed from the actual connected client (matching the existing
    `supportsReturning` getter's own client-detection convention).
  - `dynamodb` — **extended**: dot-path fields now build real multi-segment
    `ExpressionAttributeNames` aliases (`#n0.#n1.#n2`) instead of one literal alias for the whole
    dotted string (which would never have matched anything). **Confirmed pre-existing bug, fixed**:
    `$contains` with an array operand passed the whole array as a single `contains()` operand
    (DynamoDB's `contains()` only accepts a scalar) — silently wrong, not caught by any existing
    test. Now ANDs one `contains()` call per element, matching the shared reference semantics.
    Object-operand `$contains` (no native DynamoDB nested-superset function) flattens into ANDed
    per-leaf-path conditions. Verified DynamoDB's expression language — unlike SQL's
    `whereJsonPath` — treats a nested path identically to a top-level one in every position, so
    `$in`/`$nin`/null-checks combined with a dot-path field already worked correctly with no
    further code changes, just verification and a README correction (it previously undersold this).
  - `qdrant` — **extended**: `$contains` added (Qdrant's array-payload match semantics make the
    scalar case free — `match.value` against an array field already means "contains this
    element"; array/object operands flatten into ANDed conditions, same idea as dynamodb). Nested
    dot-path fields needed no translator code at all — Qdrant's `key` already accepts dot-path
    strings natively — just a capability-flag change and fixture-based test proof.
  - `supabase`, `mongodb`, `memory` — already fully correct; `nestedPaths: true` added to
    `describe()` for completeness (metadata that didn't exist before this item).
  - `neo4j`, `pinecone` — **formalized-absent**: both had already correctly rejected `$contains`
    and dot-path fields; `nestedPaths: false` added to `describe()`, and both packages' READMEs
    updated to state the restriction explicitly (architectural — neither backend can store a
    nested object at all — rather than leaving it undocumented, which is itself the kind of gap
    this item exists to close).
  Two more pre-existing, unrelated bugs found and fixed along the way, surfaced only because this
  was the first time any of this code path was exercised end-to-end through a real repository
  call rather than the translator function directly: (1) `KnexRepository.wrapError()` assumed
  every caught error was a raw driver error with a string SQLSTATE `code`, and crashed with an
  unrelated `code.slice is not a function` TypeError if a typed `MantleError` (numeric `code`,
  e.g. a `BadRequest` thrown by the where-clause translator) reached it instead — now passes
  `MantleError` instances through unchanged. (2) `mapWhereFields`'s `columnCase`/`fieldMap`
  conversion applied to an entire dotted field string, which would have silently reformatted JSON
  key names (not SQL identifiers) for any `columnCase: "snake_case"` repository — fixed to convert
  only the root segment. `npx nx run-many -t build,test,lint,typecheck` green across all 40
  projects; `CLAUDE.md`'s operator table and every affected package's README updated to match.

- [x] **2. `@mantlejs/mcp` — verify hook-pipeline equivalence** *(PRD spec 3)*
  Manifest source, raw-query absence, and expose-map granularity are already confirmed by direct inspection
  (see PRD spec 3) — no code changes expected for those three. The one open question needing a spec: does an
  MCP-originated call and an HTTP-originated call against the same service run through *identical*
  `authenticate`/`authorize` hooks, differing only in `HookContext.provider`?
  **Accept:** a spec registering one service with an `authenticate`+`authorize` hook chain, calling it once
  via HTTP and once via MCP with equivalent credentials, asserting identical accept/reject behavior.
  **Done (2026-09-22):** added `packages/mcp/src/lib/hook-pipeline-equivalence.spec.ts` — one app,
  one `articles` service, a real `authenticate("jwt")` hook (from `@mantlejs/auth`, not a stand-in)
  plus a small authorization hook, called once via `@mantlejs/http`'s REST route and once via
  `@mantlejs/mcp`'s `tools/call`, for three cases (no credentials, wrong role, right role) — all
  three confirm identical accept/reject decisions, with the recorded `HookContext.provider` the
  only thing that differs between the two calls.
  **Confirmed real, previously-undiscovered bug found and fixed while building this spec** (not
  something the spec was looking for — it surfaced while wiring up the exact assertion the
  acceptance criteria asks for, "differing only in `HookContext.provider`"): that field was
  **never populated by the dispatch pipeline at all**. `application.ts`'s `makeContext()` builds
  every `HookContext` without ever setting `.provider`, only `.params.provider` — confirmed by
  grepping the entire `@mantlejs/mantle` source for any assignment to it and finding none. This
  matters because `@mantlejs/auth`'s `authenticate()`/`sanitizeUser()` hooks correctly read
  `context.params.provider` and were never affected — but `@mantlejs/logger`'s stable, shipped
  `logRequest`/`logError` hooks read `ctx.provider` (the top-level field, per `CLAUDE.md`'s own
  documented `HookContext` shape), meaning **every deployment's log records have always shown
  `provider: undefined`**, regardless of whether the call was REST, MCP, socket.io, or truly
  internal — silently defeating exactly the "what did my agents actually do" observability this
  phase's audit-first positioning depends on. The logger package's own unit tests never caught
  this because they hand-construct `HookContext` objects with both fields set directly, never
  exercising a real dispatch. Fixed at the source — `makeContext()` now sets
  `provider: params?.provider` — rather than patching `@mantlejs/logger`, since the fix is
  correct for every current and future consumer of the documented field, not just that one
  package. Two new regression tests added directly to `@mantlejs/mantle`'s own
  `application.spec.ts` (provider mirrors `params.provider` for a real dispatched call; both are
  `undefined` for an internal call) so this can't silently regress again.
  `npx nx run-many -t build,test,lint,typecheck` green across all 40 projects.

- [x] **3. Auth hardening under concurrency** *(PRD spec 4)*
  No new OAuth strategies. Specs proving, against `@mantlejs/auth-redis` specifically: concurrent refresh
  requests against the same token don't issue two valid successors; two app instances sharing one Redis
  correctly see each other's refresh-token/OAuth-state writes including TTL/cleanup; concurrent OAuth flows
  from the same user (e.g. two tabs) don't cross-contaminate PKCE verifier/state pairs.
  **Accept:** all three specs green; existing single-instance auth specs unchanged; any bug the specs surface
  fixed before moving on (don't just document a known race — this is hardening, the point is to close gaps).
  **Done (2026-09-22):** all three claims verified against a **real Redis container** with
  genuinely concurrent, independent TCP connections (not just `Promise.all` in one process against
  the mocked `ioredis-mock` used by the permanent spec suite) — 20+ rounds x 10 real racing
  connections per claim, exactly one winner every time, zero failures: refresh-token rotation-theft
  (`consume()`/`GETDEL`), TTL actually expiring a token in real Redis, `revokeAll` actually cleaning
  up via real `SADD`/`SMEMBERS`/`DEL`, and two independent connections seeing each other's writes
  (multi-instance). This one-off live verification wasn't checked into the permanent suite — matches
  this codebase's existing convention (e.g. `@mantlejs/knex`) of proving correctness live during
  development, then encoding it as mocked specs, rather than adding a live-database dependency to CI.
  **Confirmed real bug found and fixed** in the third claim (PKCE/state cross-contamination):
  `@mantlejs/auth-oauth`'s OAuth callback handler (`create-oauth-plugin.ts`, shared by all seven
  strategies) read the pending state via a separate `stateStore.get(state)` then
  `stateStore.delete(state)` — not atomic. Two concurrent callback requests for the same `state`
  (a double-fired network request, or a replayed callback URL) could both pass the pending-state
  check before either removed it, letting both proceed to exchange the same authorization code —
  the exact race the checklist item asks to rule out, just triggered by a duplicate request rather
  than genuinely "two tabs" (each tab's own flow gets its own random `state` key, so *that*
  specific framing was never actually at risk — the real risk was replay/duplication of one flow's
  callback). Fixed by adding an atomic `consume(state)` method to the `OAuthStateStore` interface
  (`@mantlejs/auth-oauth`) — implemented via Redis `GETDEL` in `@mantlejs/auth-redis` (mirroring
  `redisRefreshTokenStore`'s already-correct rotation-theft pattern) and trivially-atomic-by-
  construction in the in-memory default (no `await` between read and delete) — and switching the
  one call site to use it. `get`/`delete` stay on the interface (additive change, not breaking) but
  are no longer used together in the vulnerable sequence anywhere in the codebase (confirmed by
  grep). New specs: `state-store.spec.ts` (new, `@mantlejs/auth-oauth`) and additions to
  `redis-state-store.spec.ts`/`redis-refresh-token-store.spec.ts` (`@mantlejs/auth-redis`), each
  proving atomicity under `Promise.all` against the mock, backed by the live-Redis verification
  above. `npx nx run-many -t build,test,lint,typecheck` green across all 40 projects; both
  packages' READMEs updated.

- [x] **4. Promote experimental adapters to stable** *(PRD — Adapter Promotion Plan)*
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
  **Done (2026-09-20):** all five packages cleared the `openapi` bar (100% statement / 93.5% branch) —
  `mongodb` 92.24%→**100%** branch, `qdrant` 85.21%→**100%**, `neo4j` 89.1%→**98.01%**, `pinecone`
  80.37%→**99.06%**, and `dynamodb` — the outlier explicitly called out for targeted work — 63.19%→**97.56%**,
  each verified via a real `nx test --coverage` run, not assumed. Every remaining uncovered branch across all
  five is a provably-unreachable defensive path (mirroring `openapi`'s own accepted 93.5%, not 100%) —
  confirmed by tracing the call graph rather than left unexamined:
  - Each adapter's operator-translation `switch`/`if` has a `default`/unsupported-operator arm that can never
    fire, because `assertOperators()` already rejects any operator outside the adapter's declared set before
    the translator's per-field dispatch runs (`dynamodbify.ts`'s `buildSpecialOp` default case,
    `pinecone-filter.ts`'s `PASSTHROUGH_OPS` check) — same category as the two prior packages' accepted gaps
  - `dynamodb`'s Query-path builders (`findPage`'s `useQuery` branch, `queryItems`) have a few
    "empty names/values" false-branches on ternaries that can't be false in practice, since a Query is only
    ever reached when the partition key is already pinned in the `where` clause — guaranteeing at least one
    name/value alias exists
  - `neo4j`'s `withTransaction` inner-callback-invocation line was investigated with temporary debug
    `console.log` instrumentation (reverted) and a forced-failure run — confirmed a v8-coverage source-map
    precision artifact on a generic arrow function, not a real gap; the test genuinely exercises that line
  **Real bugs found and fixed**, not just documentation: none of the five packages' translator/repository
  logic itself was defective — Phase 5 already fixed `pinecone`'s constructor-mismatch and `qdrant`'s Quick
  Start defects, and this pass found no *new* logic defects in any of the five. What this pass did find and
  fix were four READMEs (`pinecone`, `qdrant`, `mongodb`, `neo4j` — `dynamodb`'s already documented this
  correctly) documenting `updateById`/`patchById` without noting they throw `NotFound` on a missing record
  (while `deleteById`'s row correctly did), plus three packages (`pinecone`, `qdrant`, `neo4j`) missing an
  "Error mapping" section entirely and two more (`dynamodb`, `mongodb`) whose existing section omitted the
  MantleError-passthrough row — despite the same `wrapError()` convention applying to all five identically.
  Promotion mechanics: `dynamodb`/`pinecone`/`qdrant`/`neo4j`/`mongodb` merged into `nx.json`'s `stable`
  group (36 projects total, confirmed via the interactive prompt's project count); each package's
  `package.json` version set to `0.1.0` to match `stable`'s current version ahead of the next real bump
  (fixed-group semantics); the now-empty `experimental` group removed from `nx.json` entirely rather than
  left empty (Decision #8) — no `@mantlejs/embeddings` exists yet to occupy it. `tools/bump-peer-ranges.mjs
  stable 0.1.0` ran clean (0 files touched — nothing in the workspace peer-depends on any of the five, so no
  drift was possible). `examples/*/package.json` audited — none of the three examples reference any of the
  five promoted packages, so no exact-pin risk existed. `nx release version --groups=stable --dry-run
  --specifier=patch` bumped all 36 `stable` projects (including the five newly-merged ones) to `0.1.1` in
  lockstep with no cross-group leakage and no `preserveMatchingDependencyRanges` guard failures; `git status`
  confirmed the dry-run left no actual changes. One incidental TypeScript fix: three new `dynamodb` spec
  tests passed a composite `{ pk, sk }` object as a repository `id` — valid at runtime (the same shape the
  package's own README documents) but not assignable to the nominal `Id = string | number` type without a
  cast, caught by `dynamodb:typecheck`. Full `npx nx run-many -t build,test,typecheck` (40 projects) and
  `npx nx run-many -t lint` (40 projects) both green.

## Stage 2 — Extend

- [x] **5. Agent identity + capability scopes** *(PRD spec 10)*
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
  **Done (2026-09-22):** the deny-by-default grant shape (`Record<string, string[] | true>`) that
  `@mantlejs/mcp`'s `services` expose map already used was pulled up into `@mantlejs/mantle` as a
  named, exported type — `CapabilityScope` — plus its matcher, `matchesCapabilityScope(scope, path,
  method)` (`packages/mantle/src/lib/capability-scope.ts`). `@mantlejs/mcp`'s `McpOptions.services`
  now types against this shared `CapabilityScope` instead of an independently-written
  structurally-identical type, and `@mantlejs/auth`'s new `authorizeAgent()` hook calls the same
  matcher — one deny-by-default implementation used by both packages, per PRD Decision #4, not two
  that could drift (neither package may depend on the other per `CLAUDE.md`'s dependency matrix, so
  `@mantlejs/mantle` — which both already depend on — is the only place this could live without
  a boundary violation).
  - `@mantlejs/mantle`: `HookContext` gains `agent?: AgentContext` (`{ id, scope, delegatingUserId
    }`), additive, `params.user` untouched — `types.ts`.
  - `@mantlejs/auth`: `AuthEngine` gains `issueAgentToken(scope, delegatingUserId, options?)` →
    `{ accessToken, id, expiresAt }` (default `expiresIn: "15m"`), `revokeAgentToken(id)`, and
    `isAgentTokenValid(id)`, backed by a new `AgentTokenStore` (`add`/`isValid`/`revoke`) with an
    in-memory default (`memoryAgentTokenStore`) — same multi-instance-must-inject-a-shared-store
    caveat as the existing `RefreshTokenStore`. The agent JWT payload is `{ sub: <agent id>,
    type: "agent", scope, delegatingUserId }`. New `authorizeAgent()` hook
    (`packages/auth/src/lib/agent.ts`): skips internal calls (no `provider`, same convention as
    `authenticate("jwt")`), verifies the bearer token, requires `type === "agent"`, checks
    `isAgentTokenValid()` (revocation), matches `scope` against `path`+`method` via
    `matchesCapabilityScope` → `Forbidden` if out-of-scope, else sets `context.agent`.
    `authenticate("jwt")` was hardened to reject `type: "agent"` payloads outright — this is what
    makes `authorizeAgent()` opt-in per route: without it attached, an agent token cannot
    authenticate anywhere, regardless of the scope it carries, because the only hook that accepts
    `type: "agent"` is the one that also enforces the scope check. Header-parsing duplicated
    between `authenticate.ts` and the new `agent.ts` was factored into a shared
    `extractBearerToken()` (`bearer-token.ts`) rather than copied a third time.
  - Specs: `capability-scope.spec.ts` (mantle, matcher unit tests); `agent-token-store.spec.ts` and
    `agent.spec.ts` (auth — issuance round-trip incl. `scope`/`delegatingUserId`/expiry, revocation,
    in-scope/out-of-scope/wildcard-scope `authorizeAgent()` outcomes, and the opt-in-per-route proof
    that `authenticate("jwt")` rejects a verifiably-valid agent JWT); `agent-authorization.spec.ts`
    (mcp — a real `auth()` + `authorizeAgent()` + `RepositoryService` app, called once over REST and
    once over MCP `tools/call` with the same agent bearer token, proving identical 403 on
    out-of-scope and identical 200 + identical `HookContext.agent` on in-scope, mirroring item 2's
    hook-pipeline-equivalence spec — no MCP-specific code was needed for this, since MCP already
    forwards `Authorization` through `params.headers` into the same hook chain REST uses). One
    self-caught bug while writing the MCP spec (not shipped): `ServiceHandle.hooks()` *replaces*
    the whole hook config rather than merging, so a second `.hooks()` call on the same service
    silently dropped the first `authorizeAgent()` registration, spuriously letting an unscoped call
    through — fixed by threading test observers through the single `buildApp()` call instead of a
    second `.hooks()` call; this is existing, correct, documented `hooks()` semantics (call it once
    per service, per `CLAUDE.md`'s usage pattern), not a framework defect.
  `CLAUDE.md`'s `HookContext<T>` snippet and a new `CapabilityScope` entry added; `@mantlejs/auth`'s
  README gained an "Agent tokens" section plus `authorizeAgent()`/`AuthConfig.agentTokenStore`/Types
  entries. `npx nx run-many -t build,test,lint,typecheck` green across all 40 projects.

- [x] **6. Audit hook — `@mantlejs/audit`** *(PRD spec 11)*
  New package. Hook attachable to `before`/`after`/`error`, recording `{ principal, agentId?, path, method,
  params, result summary, timestamp }` to a pluggable sink — the sink is a `Repository<T>` the deployment
  already has, no new storage concept. When the call is agent-originated (item 5), the entry additionally
  carries the `AgentPrincipal`'s scope and delegating user.
  **Accept:** hook records a correct entry for a plain user call and an agent call (agent entry has the extra
  fields, user entry doesn't); sink proven against `@mantlejs/memory` and at least one real adapter; a sink
  write failure doesn't fail the primary operation (matches spec 7's non-fatal-on-failure rule, applied here
  even though this isn't a cross-adapter *write* per se — same failure-isolation principle); README with a
  quick start.
  **Done (2026-09-22):** new package, generated via the standard `@nx/js:library` generator
  (`packages/audit`), depending only on `@mantlejs/mantle` per the dependency matrix — no coupling
  to `@mantlejs/auth` needed, since `HookContext.agent`'s shape (`AgentContext`) already lives in
  `@mantlejs/mantle` from item 5. Single export: `auditLog(options): HookFunction`
  (`packages/audit/src/lib/audit.ts`).
  - **Design**: one hook, registered identically in `after.all` and `error.all` (no `before.all`
    registration needed — unlike `@mantlejs/logger`'s `logRequest`, `auditLog()` doesn't measure
    duration, so there's nothing to capture on the way in; the dispatch pipeline guarantees a call
    reaches exactly one of the two phases, never both, so no double-recording risk). Builds an
    `AuditRecord` — `{ principal, agentId?, agentScope?, delegatingUserId?, path, method, params?,
    status, resultSummary, timestamp }` — from the `HookContext` and calls `sink.save(record)`.
    `agentId`/`agentScope`/`delegatingUserId` are populated only when `HookContext.agent` is set
    (i.e. the call passed `@mantlejs/auth`'s `authorizeAgent()` from item 5). `resultSummary` is a
    short description (record count / id / `ClassName: message` for a thrown `MantleError`), never
    the full result payload. `params` is deliberately `ctx.params.query` only — never
    `ctx.params.headers` (bearer tokens) or the raw `ctx.params.user` object (identity already has
    its own `principal` field) — a scoping decision recorded in the README, not left implicit.
  - **Failure isolation**: `sink.save()` is wrapped in try/catch; a throw never propagates past
    `auditLog()`, satisfying "a sink write failure does not fail the primary operation" the same
    way spec 2's cross-adapter-write principle requires it elsewhere. Default failure handling
    logs via `app.get<Logger>("logger")` when `@mantlejs/logger` is configured (silent otherwise);
    `onSinkError` lets the app override that.
  - **Specs**: `audit.spec.ts` — plain-user entry (no agent fields), agent-originated entry (all
    three extra fields present), the `params` scoping proof (headers/full user object never
    appear in the stored record even when present on `ctx.params`), summary formatting for
    array/paginated/single-object/error results, and sink-failure isolation (default logger
    fallback, custom `onSinkError`, and fully silent when neither applies) — all against
    `@mantlejs/memory`. `audit-real-adapter.spec.ts` — the same unmodified `auditLog()` hook
    writing real rows to a real, no-external-service SQL database (in-memory `better-sqlite3` via
    a real `@mantlejs/knex` `KnexRepository` subclass), for both a success and an error call,
    proving the JSON-shaped fields (`params`, `agentScope`) round-trip correctly once a SQL sink
    does its own serialization (the hook itself stays storage-agnostic — serialization is the
    sink's job, not the hook's) — plus a real-table-missing case proving a genuine SQL failure
    still doesn't propagate. One structural fix found while wiring the real-adapter spec:
    `AuditRecord` needed an explicit index signature to satisfy `Repository<T extends Record<string,
    unknown>>`-constrained adapters (`MemoryRepository`, `KnexRepository`) — caught by `tsc`'s
    dedicated `typecheck` target (not `build`, which doesn't type-check spec files), not a runtime
    bug.
  - README added with Concepts (sink-as-`Repository<T>`, the two-registration pattern, the record
    shape and its redaction rationale, failure isolation) and a quick start wiring `auditLog()`
    alongside `authorizeAgent()` from item 5. `CLAUDE.md`'s package list and dependency matrix
    updated. Release-group/version tiering (Decision #3: `0.1.0-experimental` by default) is left
    to item 9 per this checklist's own stage boundaries — this item ships the package at the
    generator's placeholder version, same as any new package mid-cycle.
  `npx nx run-many -t build,test,lint,typecheck` green across all 41 projects.

- [x] **7. Auto-embed-on-write hook + cross-adapter write-consistency pattern** *(PRD specs 2 and 12)*
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
  **Done (2026-09-22):** spike findings recorded in the PRD's Decisions table (#9) before any hook
  code was written, as required — a background research pass read `upsertVector`/`findSimilar` in
  `pinecone-repository.ts`, `qdrant-repository.ts`, and `mongo-vector-repository.ts` directly:
  **all three require the caller to supply an already-computed `number[]` vector; none generates an
  embedding from source text.** Each package's own README already states this explicitly
  ("model-agnostic" / "embedding generation intentionally decoupled"), and `pinecone`/`qdrant`'s
  `save()`/`saveAll()` write an explicit zero-vector placeholder rather than a real embedding — no
  adapter disagreement, so no new item-1 conformance-matrix entry. `examples/knowledge-base` already
  hand-rolled the gap itself (`api/src/embedder.ts`'s `Embedder` interface, called manually from
  `ArticlesService.reembed()`) — confirmed net-new capability, not a duplicate.
  - **New package `@mantlejs/embeddings`**, depending only on `@mantlejs/mantle` (`VectorRepository<T>`
    is already there). Single export: `embed(options): HookFunction<T>`
    (`packages/embeddings/src/lib/embed.ts`), attached to `after.create`/`after.update`/`after.patch`.
    Extracts text via `options.field` (a field name, a list of field names joined with `"\n"`, or a
    function), calls `options.provider.embed(text)` (a one-method `EmbeddingProvider` contract — no
    embedding-model SDK bundled, matching every vector adapter's own model-agnostic stance), and
    upserts via `options.vectors.upsertVector(id, vector, {})`. Skips (no-op) when `ctx.result` is an
    array or a paginated page — nothing embeddable on a `find`. Errors from text extraction, the
    provider, or the upsert are caught and never rethrown (default: logged via
    `app.get<Logger>("logger")`; overridable via `onError`).
  - **Idempotency comes from the adapter contract, not extra hook logic**: `upsertVector` is already
    an upsert keyed by id on every adapter (`pinecone`, `qdrant`, `mongodb`'s
    `MongoVectorRepository`, `knex`'s `KnexVectorRepository`), so re-running `embed()` for the same
    id replaces rather than duplicates — proven by a spec that runs the hook three times for one id
    (as if create, then update, then patch) and asserts exactly one stored record at that id despite
    three upsert calls having happened.
  - **Specs** (`packages/embeddings/src/lib/embed.spec.ts`, 13 cases): field-extraction variants
    (single field, joined list, function), the idempotency proof above, failure-injection for both a
    throwing provider and a throwing vector store (primary operation/context untouched either way),
    `onError` override, the default-logger fallback, the array/paginated-result skip, a
    missing-record-id skip (reported via `onError`, falls back to `ctx.id` first), and the
    context-passthrough-on-success case.
  - **Cross-adapter write-consistency pattern formalized**: expanded the root `README.md`'s existing
    "Services with multiple repositories" section (this pattern already existed there in an earlier,
    example-specific form — `CLAUDE.md` itself had no such section yet) with an explicit named
    subsection stating the three properties (idempotent-keyed-on-source-id, safe-to-retry,
    non-fatal-on-failure) and naming `embed()` as the reference implementation. `CLAUDE.md` gained a
    short pointer subsection (`### Services with multiple repositories`, under "Typical Usage
    Pattern") linking to both, since the PRD names `CLAUDE.md` as the documentation target
    specifically.
  - **`examples/knowledge-base` reviewed and replaced** — the hook is a strict improvement, not just
    a lateral move: `ArticlesService.create()`/`update()`/`patch()` called `this.reembed(article)`
    with **no try/catch around it**, so an embedding-provider or vector-store failure propagated
    straight out of the service method and failed the whole request with a 500 — **even though the
    article write had already committed** — directly contradicting spec 2's non-fatal-on-failure
    requirement, and a real, previously-undocumented defect in the example (the class's own doc
    comment claimed the primary write "is not rolled back" without noting the client-facing call
    still failed). Fixed by removing `vectors`/`embedder`/`reembed()` from `ArticlesService` entirely
    (it now only composes `articles`+`activity`, plain multi-repository composition, no embedding
    knowledge) and wiring `@mantlejs/embeddings`'s `embed()` as an `after` hook on the `articles`
    service in `app.ts` instead — non-fatal by construction. `embedder.ts`'s local `Embedder`
    interface was replaced with a thin alias of `@mantlejs/embeddings`'s own `EmbeddingProvider`
    (`type Embedder = EmbeddingProvider & { readonly dimensions: number }`) rather than kept as an
    independently-defined lookalike; `localEmbedder`/`httpEmbedder`/`createEmbedder()` needed no
    changes since they already matched the shape structurally. `articles-service.spec.ts` updated to
    drop the now-removed vector/embedder test scaffolding — the embedding behavior itself is fully
    covered by `@mantlejs/embeddings`'s own 13-case spec suite, so nothing was lost, not just moved
    untested. One real TypeScript variance issue surfaced and fixed while wiring this: `embed<Article>()`'s
    return type (`HookFunction<Article>`) isn't assignable into `app.service("articles")`'s untyped
    `.hooks()` config (`HookFunction<unknown>[]`) — same as every other hook on that service, none of
    which are typed to a specific entity — resolved with a single documented `as HookFunction` cast at
    the boundary rather than parameterizing the whole `.service("articles")` call (which would have
    broken every *other* already-correct untyped hook on that service via the same variance issue in
    reverse). `examples/knowledge-base/api/package.json` and its own README updated; the
    `@mantlejs/embeddings` dependency there is pinned `^0.0.1` (the generator's placeholder version,
    matching what's actually installed right now) — **flagged for item 9** to correct once tiering
    sets the package's real version (a plain `^0.1.0` range would not satisfy an eventual
    `0.1.0-experimental` release under semver's prerelease-matching rules).
  `npx nx run-many -t build,test,lint,typecheck` green across all 42 projects.

- [x] **8. Implement `@mantlejs/auth-twitter`** *(PRD spec 13)*
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
  **Done (2026-09-22):** new package `packages/auth-twitter`, generated via the standard `@nx/js:library`
  generator, depending only on `@mantlejs/mantle` + `@mantlejs/auth-oauth` per the dependency matrix — same
  shape as `auth-google`/`auth-microsoft`. Single export: `twitterStrategy(config): MantlePlugin`
  (`packages/auth-twitter/src/lib/twitter-strategy.ts`), delegating URL construction and code exchange to
  Arctic's `Twitter` class (confirmed live: `constructor(clientId, clientSecret, redirectURI)`,
  `createAuthorizationURL(state, codeVerifier, scopes)`, `validateAuthorizationCode(code, codeVerifier)` —
  a PKCE-shaped API, confirming the PRD's expectation) and hand-writing only profile normalization, matching
  every other Arctic-backed strategy's division of labor.
  - **Endpoint/scope/shape confirmed against X's current live docs, not assumed from the PRD** (`docs.x.com`,
    fetched during implementation): `GET https://api.x.com/2/users/me`, response wrapped in a top-level
    `data` object (`{ data: { id, name, username } }` by default — no `user.fields` param needed for these
    three). Either `users.read` or `tweet.read` is documented as sufficient alone, but X's own developer
    community has repeatedly reported `403`s from this endpoint with `users.read` alone in practice — default
    scope is `["users.read", "tweet.read"]`, both, matching what's actually been confirmed working rather
    than just what the reference lists as alternatives (documented in the package README, not left as an
    unexplained default).
  - **No email, by design, not by omission**: `/2/users/me` only returns an email via `confirmed_email`,
    gated behind an app-level email access grant most apps don't have, and never returns it by default.
    Rather than requesting `user.fields=confirmed_email` speculatively (an unapproved field risks the whole
    call failing, not just being silently dropped — unconfirmed either way in X's docs), `fetchProfile()`
    always normalizes `email: undefined`. Recorded as a documented limitation in the README's "No email"
    subsection, the same treatment item 1 gave other adapters' documented capability gaps, not left implicit.
  - `entityIdField` defaults to `"twitterId"`, config is a plain `OAuthPluginConfig` (no strategy-specific
    fields — X needs no `tenant`-equivalent).
  - **Specs** (`twitter-strategy.spec.ts`, 17 cases, mirroring `google-strategy.spec.ts`'s structure exactly
    per the acceptance criteria): `createOAuthPlugin` delegation + `entityIdField`/`scope` defaults and
    overrides; `buildAuthUrl` (PKCE `code_challenge`/`code_challenge_method=S256` derived from a given
    `codeVerifier`, space-separated `scope` encoding, `usePkce: true`); `exchangeCode` (posts to Arctic's
    documented `https://api.twitter.com/2/oauth2/token`, returns `access_token`, `GeneralError` on a non-OK
    response or a missing token); `fetchProfile` (normalizes `{ data: { id, name } }` correctly, handles a
    missing `name`, always normalizes `email` to `undefined`, `GeneralError` on non-OK response, on a missing
    `id`, and on a response with no `data` object at all — one case beyond `google-strategy.spec.ts`'s set,
    added because X's wrapped-response shape has a failure mode OIDC's flat `sub` claim doesn't).
  - **CLI wiring** — found four touchpoints requiring updates, not the one file
    (`packages/cli/src/lib/versions.ts`) the checklist item names; that file only holds third-party version
    pins and has no auth-choice list — the actual choice list is spread across `bin/mantle.ts` (help text),
    `lib/new.ts` (`Auth` type, `OAUTH_AUTH_VALUES`, the interactive prompt, `OAUTH_STRATEGY_TEMPLATES` for
    `mantle new`), `lib/wiring.ts` (`PACKAGE_WIRINGS`, for `mantle add @mantlejs/auth-twitter` on an existing
    app), and `lib/generators/authentication.ts` (`OAUTH_STRATEGIES`, for `mantle generate authentication`).
    All four updated with `twitter`/`twitterStrategy`/`TWITTER_CLIENT_ID`/`TWITTER_CLIENT_SECRET` alongside
    the existing seven; `new.spec.ts`'s parametrized OAuth-wiring test and
    `generators/authentication.spec.ts`'s detection test both extended to cover `twitter`. `create-mantlejs`
    needed no changes — it re-exports `@mantlejs/cli`'s own `Auth` type and forwards flags verbatim, so it
    picked up the new choice automatically.
  - `CLAUDE.md`'s package list + dependency matrix and the root `README.md`'s package table both gained an
    `@mantlejs/auth-twitter` row.
  - Package ships at the generator's placeholder version (`0.0.1`), **not** added to `nx.json`'s `stable`
    group yet — per this checklist's own stage boundaries (see item 6/7's precedent) and per item 9's own
    text, which explicitly claims "`@mantlejs/auth-twitter` joins `stable` directly (PRD Decision #7)" as
    release-stage work; doing it here would duplicate/preempt that.
  `npx nx run-many -t build,test,lint,typecheck` green across all 43 projects (up from 42); the
  `create-mantlejs` `e2e-scaffold` target (real scaffold → `npm install` against workspace-linked packages →
  build → test → boot → CRUD round-trip → `SIGTERM` → clean exit) re-run and still green, confirming the new
  `--auth twitter` choice didn't disturb the existing `--auth none` path the smoke test exercises.

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
