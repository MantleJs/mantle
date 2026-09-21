# Mantle JS — Phase 6 PRD: BaaS Readiness

**Status:** Draft
**Date:** 2026-09-15

---

## Contents

1. [Overview](#overview)
2. [Goals & Non-Goals](#goals--non-goals)
3. [Delivery Sequence](#delivery-sequence)
4. [Phase 6 Specifications](#phase-6-specifications)
5. [Adapter Promotion Plan](#adapter-promotion-plan)
6. [Release Plan](#release-plan)
7. [Package Structure Additions](#package-structure-additions)
8. [Success Metrics](#success-metrics)
9. [Architectural & Design Decisions](#architectural--design-decisions)

---

## Overview

Phase 5 shipped the first public release: 31 packages at `0.1.0`, five newer adapters at
`0.1.0-experimental`, a canonical example, and a working publish pipeline. Phase 6 has a different job.
[`BAAS-READINESS.md`](./BAAS-READINESS.md) — a gap analysis written against the released surface — concludes
that Mantle's package breadth is already unusually complete for a framework at this stage (three transports,
six relational/document/graph adapters, two vector-store adapters, nine auth packages, three storage adapters,
realtime sync, OpenAPI generation, an MCP server). The gap is not missing packages; it's **uneven confidence
across what exists**, plus **three small, targeted additions** that turn the existing architecture into a
specific, defensible market position: the polyglot, agent-native, audit-first BaaS.

Phase 6 delivers, in this order:

1. **Harden what exists** — adapter conformance parity, a documented cross-adapter write-consistency pattern,
   verification of `@mantlejs/mcp`'s introspection and hook composition, auth hardening under concurrent/
   multi-instance conditions, and **promoting the five experimental adapters to stable** once they clear the
   same bar `@mantlejs/openapi` cleared in Phase 5
2. **Three targeted additions** — agent identity + capability scopes (extends `@mantlejs/auth` +
   `@mantlejs/mcp`), an audit hook (new `@mantlejs/audit`), and an auto-embed-on-write hook (new
   `@mantlejs/embeddings`, pending a scope-verification spike)
3. **An eighth OAuth strategy** — `@mantlejs/auth-twitter` (X/Twitter sign-in), added directly to this phase's
   scope rather than derived from `BAAS-READINESS.md`'s own priorities, which explicitly argue against more
   providers — see [Decisions](#architectural--design-decisions) #7
4. **Release** — version and publish everything above, following the same `nx release` pipeline Phase 5 built
   and hardened

This PRD does not introduce new architectural concepts beyond what `CLAUDE.md` already defines. Every addition
in Part 2 builds directly on primitives that already exist: the hook pipeline, the `Repository<T>` contract,
and `@mantlejs/mcp`'s expose map. Item 3 is the one exception to that framing — it's not derived from
`BAAS-READINESS.md` at all, just riding along in the same release.

---

## Goals & Non-Goals

### Goals

- Close the two documented, concrete gaps in the `QueryParams` operator table (`$contains` and nested
  dot-paths) for every adapter where it's semantically possible, or formalize the remaining gaps as a
  discoverable capability matrix — not a silent behavior difference
- Document, once, the standard pattern for a cross-adapter write (idempotent upsert keyed on source id, safe
  to retry, non-fatal on failure) before the auto-embed hook needs to invent one
- Confirm (or fix) that `@mantlejs/mcp` and `@mantlejs/openapi` introspect the same service metadata, that
  deny-by-default operates at individual-method granularity and composes with the existing hook pipeline, and
  that no code path allows raw query passthrough through the MCP surface
- Prove refresh-token rotation, `auth-redis`'s multi-instance stores, and PKCE state handling hold up under
  concurrent/multi-instance conditions — hardening, not new providers
- **Promote `@mantlejs/dynamodb`, `pinecone`, `qdrant`, `neo4j`, and `mongodb` from `0.1.0-experimental` to the
  stable tier**, each individually clearing the bar `openapi` cleared in Phase 5 (see
  [Adapter Promotion Plan](#adapter-promotion-plan))
- Ship an `AgentPrincipal` concept: short-lived, capability-scoped (verb × service path), revocable tokens
  distinct from user JWTs, with an `authorizeAgent()` hook enforcing them and `HookContext` able to
  distinguish an agent-originated call (and its delegating user) from an ordinary authenticated request
- Ship `@mantlejs/audit` — a hook attachable like any other, recording `{ principal, agentId?, path, method,
  params, result summary, timestamp }` to a pluggable sink, where the sink is itself just a `Repository<T>`
- Verify what "embedding support" in `pinecone`/`qdrant`/`mongodb` actually means today (developer supplies
  the vector, or the adapter generates it), then ship an auto-embed-on-write hook if the former is confirmed
- Ship `@mantlejs/auth-twitter` — X/Twitter sign-in over the `@mantlejs/auth-oauth` base (explicit scope
  addition — see [Decisions](#architectural--design-decisions) #7)
- Publish everything above via the same `nx release` pipeline (two fixed groups collapse into effectively one
  once promotion lands — see [Release Plan](#release-plan))

### Non-Goals (Phase 6)

Per `BAAS-READINESS.md`'s explicit guidance — *"resist the urge to add packages beyond those three; every
adapter/provider package you already have is better spent finishing than duplicating"* — the following, all
of which add new package surface rather than harden existing surface, are deferred again, now to the
[Phase 7 backlog](./mantle-js-phase-7-backlog.md):

- `KnexTimeSeriesRepository` — carried from the old Phase 6 backlog, item 1
- `@mantlejs/arangodb` — carried from the old Phase 6 backlog, item 2 (the polyglot-adapter story is better
  served by making the *existing* six relational/document/graph adapters fully conformant first, per Goal 1,
  than by adding a seventh)
- Mantle website (mantlejs.org) — carried, item 3
- Mantle UI library (Supabase-UI-style) — carried, item 4
- GraphQL transport, rate limiting plugin, multi-tenancy primitives, Vue/Svelte/Solid/Angular bindings,
  Neptune/Cosmos adapters — carried, item 5 (originally deferred from Phase 4)

Also explicitly out of scope, per `BAAS-READINESS.md`'s own scoping — these belong in a **separate
control-plane application** that *uses* Mantle, never in this monorepo:

- Multi-tenant project provisioning, per-tenant database isolation
- Studio/dashboard UI (table browser, auth admin, logs, agent-activity view)
- Billing/quota enforcement, secrets/env management across tenants
- Migration/schema-diff UX beyond what `@mantlejs/cli`'s scaffolding already does

---

## Delivery Sequence

Phase 6 runs in three stages. Unlike Phase 5 — where the release was strictly last because the release
*was* the deliverable — here the release is last because everything before it changes what gets released
(promoted tier membership, three new packages, an extended `HookContext`).

1. **Harden** — adapter conformance matrix, `@mantlejs/mcp` verification, auth hardening, adapter promotion.
   Sequenced first because Part 2's additions build on primitives (the hook pipeline, `@mantlejs/mcp`'s
   composition guarantees) this stage confirms or fixes.
2. **Extend** — agent identity + capability scopes, `@mantlejs/audit`, the auto-embed hook (which also
   formalizes the cross-adapter write-consistency pattern this stage needs, using the auto-embed hook as the
   first concrete case — deliberately sequenced after there's a real example to design against, per
   `BAAS-READINESS.md`'s own suggested ordering), and `@mantlejs/auth-twitter` (independent of the other two —
   no shared primitives, can land in parallel with either)
3. **Release** — finalize tier placement for new/promoted packages, version, publish

---

## Phase 6 Specifications

### 1. Adapter conformance matrix *(BAAS-READINESS §1.1)*

The `QueryParams` operator table in `CLAUDE.md` documents two concrete, confirmed gaps today:

- `$contains` works on memory, supabase, knex-on-pg, dynamodb, mongodb — not on knex-mysql, knex-sqlite,
  knex-mssql, neo4j, pinecone, or qdrant
- Nested dot-path queries (`"metadata.tags"`) work on memory, supabase, mongodb — not on the other seven

For each gap, per adapter: either extend the operator where semantically possible (MySQL 5.7+ and MSSQL both
have JSON functions that can approximate `$contains`; graph/vector stores may not have an equivalent at all),
or formalize the absence as a `describe().capabilities` entry so it's a compile-time/runtime-discoverable
signal instead of a silent divergence discovered in production. `assertOperators`'s fail-loud rejection path
already exists — extend, don't replace it.

**Accept:** every stable and to-be-promoted adapter's `describe().capabilities.operators` accurately reflects
what `assertOperators` actually accepts (no drift between advertised and enforced capability); for each of the
two gaps, a written decision (per adapter: extended, or formalized-absent) recorded in this PRD's
[Decisions](#architectural--design-decisions) table; extended adapters covered by the existing
`NESTED_QUERY_CASES`/shared conformance fixtures from `@mantlejs/mantle`.

**Done (2026-09-20):** full per-adapter breakdown and the real bugs found along the way (a confirmed
`knex` `describe()` drift matching the one predicted above, a pre-existing DynamoDB `$contains`
array-operand bug, a `KnexRepository.wrapError()` crash on typed `MantleError`s, and a
`mapWhereFields` column-case bug that would have mangled JSON key names) are recorded in the
[Phase 6 Checklist](./mantle-js-phase-6-checklist.md) item 1 — not duplicated here to avoid drift
between the two documents. `CLAUDE.md`'s operator table now carries the full per-adapter/per-client
matrix this spec called for.

### 2. Cross-adapter write consistency pattern *(BAAS-READINESS §1.2)*

`CLAUDE.md` already documents, correctly, that cross-adapter writes aren't atomic. Formalize the standard
pattern once, in `CLAUDE.md`'s "Services with multiple repositories" section: cross-adapter writes are
idempotent upserts keyed on the source record's id, safe to retry, and their failure is non-fatal to the
primary write (logged, not rolled back). Design this against the auto-embed hook (spec 8 below) as the first
concrete case, not in the abstract — sequenced accordingly.

**Accept:** documented pattern in `CLAUDE.md`; the auto-embed hook (if built) is the reference implementation;
existing `articles`-service multi-repo example in `examples/knowledge-base` reviewed against the pattern and
updated if it diverges.

### 3. `@mantlejs/mcp` verification *(BAAS-READINESS §1.3)*

Already confirmed true by direct inspection during this PRD's research, recorded here so the checklist item is
verification-and-spec, not investigation-from-scratch:

- **Manifest source of truth — confirmed shared.** Both `packages/mcp/src/lib/tools.ts` and
  `packages/openapi/src/lib/openapi.ts` call the same `app.service(path).describe()` (`ServiceHandle.describe()`
  on `@mantlejs/mantle`). No divergent introspection to unify.
- **No raw query passthrough — confirmed absent.** No `raw()`/`rawQuery()`/`execute()`-style escape hatch
  exists anywhere in `packages/mcp/src/lib/*.ts`.
- **Expose-map granularity — confirmed per-method.** The expose map's value type is `string[] | true` per
  service path (`resolve-expose-map.ts`), not an all-or-nothing per-service switch.

What's *not yet confirmed* and needs an explicit spec: that an MCP-originated call and an HTTP-originated call
against the same service run through *identical* `authenticate`/`authorize` hooks, differing only in
`HookContext.provider` — item 1's original acceptance coverage proves the pipeline runs under MCP, but not
side-by-side equivalence with the HTTP path for the same hook chain.

**Accept:** a spec that registers one service with an `authenticate`+`authorize` hook chain, calls it once via
HTTP and once via MCP with equivalent credentials, and asserts identical accept/reject behavior — the only
difference being `HookContext.provider`.

**Done (2026-09-22):** confirmed, with one significant catch — recorded in full in the
[Phase 6 Checklist](./mantle-js-phase-6-checklist.md) item 2, not duplicated here. Building the exact
assertion this spec asks for surfaced a real, previously-undiscovered bug: `HookContext.provider`
was never populated by the dispatch pipeline at all (only `params.provider` was), which meant
`@mantlejs/logger`'s stable `logRequest`/`logError` hooks — which read that exact field — had
always logged `provider: undefined` for every request in every deployment. Fixed at the root in
`@mantlejs/mantle`'s `makeContext()`, with new regression coverage in `application.spec.ts`.

### 4. Auth hardening *(BAAS-READINESS §1.4)*

No new OAuth strategies. Confirm, under concurrent/multi-instance conditions (the failure mode that doesn't
show up at compile time):

- Refresh-token rotation — concurrent refresh requests against the same token don't issue two valid successors
- `auth-redis`'s multi-instance stores — two app instances sharing one Redis correctly see each other's
  refresh-token and OAuth-state writes, including the state TTL/cleanup path
- PKCE state handling — concurrent OAuth flows from the same user (e.g. two tabs) don't cross-contaminate
  verifier/state pairs

**Accept:** specs for each of the three bullets above, run against `@mantlejs/auth-redis` specifically (the
multi-instance-relevant store); existing single-instance auth specs unchanged.

**Done (2026-09-22):** all three verified against a real Redis container with genuinely concurrent
connections, not just mocked `Promise.all`. Full detail — including a confirmed, fixed bug in the
third claim (the OAuth callback handler's state-consumption wasn't atomic, shared by all seven
strategies) — recorded in the [Phase 6 Checklist](./mantle-js-phase-6-checklist.md) item 3.

### 5–9. Promote experimental adapters to stable

See [Adapter Promotion Plan](#adapter-promotion-plan) — large enough to warrant its own section.

### 10. Agent identity + capability scopes *(BAAS-READINESS §2.1)*

The addition, concretely:

- `AgentPrincipal`: short-lived, capability-scoped (an explicit list of `path`+`method` pairs, or path-level
  wildcards), revocable, carrying a `delegatingUserId` reference. Minted by a new token-issuance flow in
  `@mantlejs/auth` (it already owns the JWT engine), separate from user JWTs and any server-side/service-role
  credential.
- `authorizeAgent()`: a hook, alongside the existing `authenticate()`, checking the token's capability list
  against `HookContext.path`+`HookContext.method`. Deny-by-default, same enforcement shape `@mantlejs/mcp`
  already uses for its expose map — reuse that logic rather than reimplementing it.
- `HookContext` gains a discriminated way to tell an agent-originated call (with its scope and delegating
  user) from an ordinary authenticated request — likely `HookContext.agent?: { id, scope, delegatingUserId }`,
  additive, no breaking change to the existing `params.user` shape.

**Accept:** token-issuance spec (capability list round-trips, expiry enforced); `authorizeAgent()` spec
(in-scope call passes, out-of-scope call → `Forbidden`, matching the expose map's own denial shape);
`HookContext.agent` populated correctly end-to-end through `@mantlejs/mcp`'s existing dispatch path; a spec
proving an agent token *cannot* be used as a substitute for a user JWT on a route with no `authorizeAgent()`
hook (i.e. it's opt-in per route, not a silent global bypass).

### 11. Audit hook — `@mantlejs/audit` *(BAAS-READINESS §2.2)*

New, small package. A hook attachable to `before`/`after`/`error` like any other, recording `{ principal,
agentId?, path, method, params, result summary, timestamp }`. The sink is a `Repository<T>` the deployment
already has — no new storage concept. Pairs with spec 10: log the `AgentPrincipal`'s scope and delegating user
on every entry when the call was agent-originated.

**Accept:** hook records an entry for a plain user call and an agent call, with the agent entry additionally
carrying scope + delegating user; sink is a generic `Repository<T>`, proven against `@mantlejs/memory` and at
least one real adapter in a spec; a failed write (per Decision — see below) does not fail the primary
operation; README with a quick start wiring the hook into an existing service.

### 12. Auto-embed-on-write hook — scope verification, then `@mantlejs/embeddings` *(BAAS-READINESS §2.3)*

**First, verify, before building anything:** does `@mantlejs/pinecone`, `@mantlejs/qdrant`, or MongoDB's
`MongoVectorRepository` generate embeddings from source text today, or does the caller always supply a
ready-made vector? Spike this as the first task under this spec — if some adapters already generate
embeddings and others don't, that's itself a conformance gap for spec 1.

If the caller must always supply the vector (expected outcome, based on the vector-repository APIs read during
this PRD's research — `upsertVector(id, vector, ...)` takes a vector, not text), build the hook: `after: {
create: [embed({ field: "body", provider: openaiEmbeddings() })] }`, calling a pluggable embedding provider and
upserting into whichever vector adapter is configured. Follows spec 2's consistency pattern exactly (idempotent
upsert keyed on source id, non-fatal on failure).

**Accept:** spike findings recorded in this PRD's Decisions table before any code lands; if built — hook spec
proving the upsert is idempotent (same source id, re-run, no duplicate vector), a failure-injection spec
proving the primary write survives an embedding-provider failure, and a real usage in
`examples/knowledge-base` replacing its current manual embed-on-create call (see
`api/src/services/articles-service.ts`) if the scope verification confirms this is net-new capability rather
than something the example already hand-rolls equivalently.

### 13. `@mantlejs/auth-twitter` *(explicit scope addition — see Decision #7)*

New package over `@mantlejs/auth-oauth` + Arctic, following the exact precedent of `auth-google`/
`auth-microsoft`/`auth-linkedin`. Arctic's provider class is `Twitter` (not `X`) — `createAuthorizationURL`
takes a `codeVerifier`, confirming this is a **PKCE** strategy, same posture as `auth-google`/`auth-microsoft`,
not the no-PKCE posture `auth-github`/`auth-facebook`/`auth-linkedin` use. Standard GET callback (Arctic's
`Twitter` class has no `form_post`/POST-callback signature, unlike Apple). Profile fetched from X's API v2
`users/me` endpoint; `entityIdField` default `"twitterId"`; config is plain `OAuthPluginConfig`. Confirm the
exact userinfo endpoint path, required scopes (expect `users.read` at minimum; `tweet.read` if any profile
field requires it), and current response shape against X's live developer docs during implementation — API
surface and branding both move fast on this platform, more so than the other six providers already shipped.
Update `CLAUDE.md` dependency matrix + root README + `packages/cli/src/lib/versions.ts`'s auth-choice list
(the CLI scaffolds all seven existing strategies as `--auth` choices; this becomes an eighth) once merged.

**Accept:** specs mirroring `google-strategy.spec.ts` (PKCE URL construction including `codeVerifier`;
exchange failure; userinfo normalization with/without optional profile fields; missing `sub`/user-id field →
`GeneralError`); `create-mantlejs` e2e-scaffold smoke test still green with the new `--auth` choice added.

---

## Adapter Promotion Plan

Phase 5's item 9 tier-list finalization kept `dynamodb`/`pinecone`/`qdrant`/`neo4j`/`mongodb` experimental
because a coverage review found real defects in three of them. Re-checked during this PRD's research
(2026-09-15):

| Package | Phase 5 finding | Current state | Branch coverage today |
| --- | --- | --- | --- |
| `pinecone` | README described a constructor API that didn't exist in code | **Fixed** — README's `constructor(app: MantleApplication)` matches `pinecone-repository.ts` exactly | 80.37% → **99.06%** |
| `qdrant` | Flagship Quick Start used an unsupported operator | **Fixed** — Quick Start now uses only plain equality (`where: { category: "guide" }`), which every adapter supports | 85.21% → **100%** |
| `dynamodb` | Lowest branch coverage of the group, 62.8% | **Fixed** — closed via targeted test additions (composite-key paths, transaction buffering, cursor/pagination edge cases, error-wrapping fallthroughs); a handful of provably-unreachable defensive branches remain (see below) | 63.19% → **97.56%** |
| `neo4j` | Not separately called out | Reviewed this round — README-vs-code accurate, flagship example clean; one line (`withTransaction`'s inner-callback invocation) is a confirmed v8-coverage source-map artifact, not a real gap (verified via forced-failure debug instrumentation, then reverted) | 89.1% → **98.01%** |
| `mongodb` | Not separately called out | Reviewed this round — README-vs-code accurate (one stale error-mapping row fixed); flagship example clean | 92.24% → **100%** |

`openapi`'s promotion bar (Phase 5, item 9): 100% statement / 93.5% branch, zero defects found in a dedicated
review. **All five packages now meet or exceed both halves of the bar.** Each package's remaining
uncovered branches (where any exist) are defensive code provably unreachable through the public API —
e.g. a `default:` arm in an operator-translation `switch` that can never fire because `assertOperators`
already rejects any operator not handled by an earlier case — the same category of accepted gap that
keeps `openapi` itself at 93.5% rather than 100%, not an overlooked test case.

**Promotion work, per package:**

1. `dynamodb` — targeted branch-coverage work closing the gap to the openapi bar (or documented rationale for
   accepting a lower bar than the last promotion, decided explicitly, not by default)
2. `pinecone`, `qdrant`, `neo4j`, `mongodb` — a dedicated review pass matching Phase 5 item 9's process
   (README-vs-code accuracy audit, flagship example runs without error, branch coverage), same rigor, to
   confirm no *new* defects have crept in since Phase 5 rather than assuming the clean bill of health holds
3. All five — `describe().capabilities.operators` accuracy re-checked as part of spec 1's conformance matrix
   work, since capability-reporting accuracy is itself a promotion-relevant defect class (the same class as
   `pinecone`'s constructor mismatch — docs/metadata claiming something the code doesn't do)
4. Once each package individually clears the bar: merge `dynamodb`, `pinecone`, `qdrant`, `neo4j`, `mongodb`
   into `nx.json`'s `stable` release group. Since `projectsRelationship: "fixed"` requires every group member
   share one version, each promoted package's version jumps directly to whatever `stable`'s current version is
   at merge time (skipping intermediate version numbers) — mechanically identical to how `auth-apple`/
   `auth-microsoft`/`auth-linkedin` joined `stable` from a standing start in Phase 5
5. **A package that doesn't clear the bar stays experimental** — promotion is per-package, not all-or-nothing
   for the group. If `dynamodb`'s coverage work isn't done by the time Phase 6 releases, ship the other four
   promoted and `dynamodb` still experimental, exactly as `openapi` alone was promoted in Phase 5 while the
   other four weren't.

**Accept:** each promoted package individually meets or exceeds the documented bar, with the comparison
recorded (mirroring the table above, updated); `tools/bump-peer-ranges.mjs` and any peer-range references to
the promoted packages updated for their new stable version; `nx release version --groups=stable --dry-run`
shows the expected project list with no cross-group leakage (same verification method Phase 5's item 9 used
for the original group split).

---

## Release Plan

Builds on the pipeline Phase 5 built and hardened — no new tooling decisions expected, but several concrete
mechanical steps this phase's changes require:

- **New packages default to experimental**, per the standing "no substantial new package goes straight to
  stable in the phase it's introduced" rule (Phase 5 Decision #11's own framing) — `@mantlejs/audit` and
  `@mantlejs/embeddings` (if built) ship `0.1.0-experimental` unless a Phase 6 stage-2 tier-list review finds
  cause for an exception, mirroring exactly how Phase 5 handled this same question for every new package
  except `mcp`. **`@mantlejs/auth-twitter` is the established exception to this default** (Decision #7) — it
  joins `stable` directly at `stable`'s current version, same as `auth-apple`/`auth-microsoft`/`auth-linkedin`
  did in Phase 5
- **Promoted adapters version-jump into `stable`** at merge time — see
  [Adapter Promotion Plan](#adapter-promotion-plan) point 4; run the same dry-run verification Phase 5's item 9
  used before the first real version bump
- **`experimental` group after promotion**: if all five packages promote, the `experimental` fixed group in
  `nx.json` becomes empty (or holds only `@mantlejs/embeddings`, if that ships experimental) — decide at
  release-plan time whether an empty/near-empty group is removed from `nx.json` outright or kept as
  infrastructure for future experimental packages; either is fine, pick one and record it in Decisions
- **Peer-dependency ranges**: promoted packages' `peerDependencies` on `@mantlejs/mantle` (etc.) need the same
  `^0.1.0` → `^{new stable version}` treatment every stable package got when `mantle` last moved — run
  `tools/bump-peer-ranges.mjs` for the `stable` group as usual, it already covers packages moving *into* the
  group correctly (this is exactly what happened when `auth-apple`/`microsoft`/`linkedin` joined in Phase 5)
- **`examples/*` exact-pin risk**: Phase 5's item 12 found that `examples/*/package.json` pinning internal
  `@mantlejs/*` deps at an exact version breaks the moment that version moves. Audit `examples/knowledge-base`'s
  `package.json` for exact pins on any of the five promoted packages *before* running `nx release version` —
  same bug, same fix, but check proactively this time instead of discovering it mid-release
- **CI**: no changes expected to `ci.yml`/`release-publish.yml` beyond what a normal version bump requires;
  Node 22 and the npm-Arborist-version pin from Phase 5 remain correct as-is

---

## Package Structure Additions

```text
mantle/
├── packages/
│   ├── [all Phase 1–5 packages]
│   ├── audit/            @mantlejs/audit       [NEW P6]
│   ├── embeddings/       @mantlejs/embeddings  [NEW P6 — pending scope verification, spec 12]
│   └── auth-twitter/     @mantlejs/auth-twitter [NEW P6]
```

### Updated Package Dependency Rules (Phase 6 additions)

| Package | May depend on |
| --- | --- |
| `@mantlejs/audit` | `@mantlejs/mantle` |
| `@mantlejs/embeddings` | `@mantlejs/mantle` (adapter-specific vector repository packages as peer deps, not hard deps — mirrors how `@mantlejs/storage-s3`/`-gcs` relate to `@mantlejs/storage`) |
| `@mantlejs/auth-twitter` | `@mantlejs/mantle`, `@mantlejs/auth-oauth` |

No changes to any existing package's allowed dependencies. `dynamodb`/`pinecone`/`qdrant`/`neo4j`/`mongodb`'s
entries in the dependency matrix are unchanged by promotion — moving release *tier* doesn't change the
architectural dependency rules, only which `nx.json` release group and npm dist-tag a package ships under.

`CLAUDE.md`'s dependency matrix and the root README packages table are updated when these land.

---

## Success Metrics

- `describe().capabilities.operators` for every stable-and-promoted adapter matches what `assertOperators`
  actually enforces — zero drift between advertised and real capability
- All five formerly-experimental adapters live at the `stable` tier's current version, dist-tag `latest`, or
  explicitly documented as still-experimental with a stated reason (not silently left behind)
- An MCP-issued `AgentPrincipal` token can call an in-scope service method and is denied on an out-of-scope
  one, with the denial indistinguishable in shape from an ordinary hook-pipeline `Forbidden`
- Every call an `AgentPrincipal` makes produces exactly one queryable audit record, retrievable via a normal
  `Service<T>.find()` call against the audit sink — "what did my agents actually do" is an API call, not a
  grep through logs
- `npx nx run-many -t build,test,lint,typecheck` green across the workspace, including all new packages
  (`@mantlejs/audit`, `@mantlejs/embeddings` if built, `@mantlejs/auth-twitter`)
- Zero regressions in the canonical example (`examples/knowledge-base`) from the promotion or the two new hooks
- `create-mantlejs` scaffolds a working X/Twitter login flow when `--auth twitter` is selected, exercised by
  the same `e2e-scaffold` smoke test every other auth choice already goes through

---

## Architectural & Design Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | Defer `KnexTimeSeriesRepository`, `@mantlejs/arangodb`, the website, and the UI library again, to a new Phase 7 backlog | `BAAS-READINESS.md` explicitly recommends hardening existing adapters over adding new ones; none of these four serve the agent-native/audit-first positioning directly, unlike every Phase 6 goal |
| 2 | Adapter promotion is per-package, not all-or-nothing | Matches Phase 5's own precedent (`openapi` promoted alone while four siblings stayed experimental) — a group-wide bar would either hold back four ready packages for one straggler, or lower the bar for everyone to match the straggler |
| 3 | `@mantlejs/audit` and `@mantlejs/embeddings` default to `0.1.0-experimental` at first release | Standing rule from Phase 5 (Decision #11): new packages don't go straight to stable in their introduction phase, absent a flagship-differentiator exception like `mcp`'s. Revisit at the Phase 6 stage-2 tier-list review if evidence argues otherwise, same process Phase 5 used for `openapi` |
| 4 | `authorizeAgent()` reuses `@mantlejs/mcp`'s expose-map denial logic rather than a parallel implementation | Two independent deny-by-default implementations for adjacent concerns (MCP tool exposure, agent capability scope) is exactly the kind of drift `BAAS-READINESS.md` §1.3 warns about for the manifest-source question — same principle applies here even though this is new code, not existing code |
| 5 | Cross-adapter write-consistency pattern is documented once the auto-embed hook gives a concrete case, not designed in the abstract first | Direct from `BAAS-READINESS.md`'s own suggested sequencing (§"Suggested sequencing", point 6) |
| 6 | The auto-embed hook's scope is verified *before* any code is written | `BAAS-READINESS.md` is explicit that this might already be partially or fully done — building `@mantlejs/embeddings` without checking first risks duplicating capability that `MongoVectorRepository`, `pinecone`, or `qdrant` already has |
| 7 | Add `@mantlejs/auth-twitter` to Phase 6, despite `BAAS-READINESS.md` §1.4 explicitly recommending against more OAuth strategies | Explicit scope addition (2026-09-17) — not derived from the readiness doc's own priorities, added directly. Follows the Phase 5 precedent for *new OAuth strategy* packages specifically (Phase 5 Decision, tiering section): a thin strategy over the already-battle-tested `auth-oauth` base ships stable despite being new, same as `auth-apple`/`auth-microsoft`/`auth-linkedin` did — this is a narrower, already-established exception to the general "new packages default to experimental" rule (Decision #3), not a second exception being invented here |
| 8 | Remove the `experimental` release group from `nx.json` outright once all five of `dynamodb`/`pinecone`/`qdrant`/`neo4j`/`mongodb` promoted, rather than leaving it empty | All five cleared the promotion bar in the same pass (item 4), so nothing remained in the group. `@mantlejs/embeddings` hasn't been built yet (spec 12 is still pending) — if it ships experimental later, the group is trivially re-added at that point with a single package rather than kept around empty in the meantime |

---

## Reference

- [`BAAS-READINESS.md`](./BAAS-READINESS.md) — primary input to this PRD; gap analysis and priority rationale
- [Phase 6 Checklist](./mantle-js-phase-6-checklist.md)
- [Phase 7 Backlog](./mantle-js-phase-7-backlog.md) — items deferred again out of this PRD
- [Phase 5 PRD](./mantle-js-phase-5-prd.md) — publish-tiering precedent, Decisions #11/#12 (the promotion bar
  this phase's Adapter Promotion Plan applies)
- [Phase 5 Checklist](./mantle-js-phase-5-checklist.md) — item 9 (original tier-list finalization process)
- [AI-First Architecture Review](./ai-first-architecture-review.md) — earlier findings on `QueryParams`
  operator divergence across adapters; several already resolved in Phases 4–5, background for spec 1
- [`docs/releasing.md`](../releasing.md) — the publish runbook this phase's release plan builds on
