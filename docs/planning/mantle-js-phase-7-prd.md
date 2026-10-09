# Mantle JS — Phase 7 PRD: Agent Code Mode, UI Registry, Website

**Status:** Draft
**Date:** 2026-10-06

---

## Contents

1. [Overview](#overview)
2. [Goals & Non-Goals](#goals--non-goals)
3. [Delivery Sequence](#delivery-sequence)
4. [Phase 7 Specifications](#phase-7-specifications)
5. [Release Plan](#release-plan)
6. [Package Structure Additions](#package-structure-additions)
7. [Success Metrics](#success-metrics)
8. [Architectural & Design Decisions](#architectural--design-decisions)

---

## Overview

Phase 6 hardened the released surface and added the three agent-native/audit-first primitives
(`AgentPrincipal` + `authorizeAgent()`, `@mantlejs/audit`, `@mantlejs/embeddings`). With that foundation in
place, Phase 7 turns outward. It has three themes:

1. **MCP code mode** (`@mantlejs/mcp-code`). This is new and not from the backlog. Today `@mantlejs/mcp` gives an
   agent one tool per exposed service method. That works, but every tool definition sits in the model's context
   on every turn, and every intermediate result goes back through the model before the next call. Code mode
   gives the agent a **typed TypeScript API** for the exposed services instead. The agent writes a short script
   against it, and the script runs in a **sandbox**: many service calls in one round trip, filtering and joining
   done in code, and only the final result goes back to the model. Each call inside the script still runs
   through the service's full hook pipeline (`authenticate`, `authorizeAgent`, validation, audit), so the
   no-bypass guarantee `@mantlejs/mcp` already makes still holds. This is the agent-native positioning taken one
   step further: the expose map, capability scopes, and audit trail are what make letting an agent write code
   against your API reasonable.
2. **Mantle UI registry** ([backlog item 4](./mantle-js-phase-7-backlog.md#4-mantle-ui-library-supabase-ui-style)).
   Prebuilt, copy-pasteable React blocks wired to Mantle: auth forms, OAuth buttons, upload dropzones, realtime
   lists and tables, and pagination. They're distributed as a **shadcn registry** and built on **React Aria**,
   which is now a first-class component base in shadcn/ui. React Aria brings accessible behavior (keyboard,
   focus, ARIA, internationalized interactions), which hand-rolled components rarely get right.
3. **Mantle website** ([backlog item 3](./mantle-js-phase-7-backlog.md#3-mantle-website)). A docs and marketing
   site built with **Astro Starlight**. It also hosts the UI registry and publishes `llms.txt` for agents that
   read the docs directly.

The remaining backlog items (`KnexTimeSeriesRepository`, `@mantlejs/arangodb`, and the Phase 4 non-goal
grab-bag) move to the [Phase 8 backlog](./mantle-js-phase-8-backlog.md).

---

## Goals & Non-Goals

### Goals

- Ship `@mantlejs/mcp-code`. It exposes a typed TypeScript API for every exposed service method, plus two tools:
  `search_api`, which loads the API piece by piece, and `execute`, which runs a script in a sandbox. Every inner
  call goes through `service.dispatch()` with the session's identity.
- Add a small, additive extension point to `@mantlejs/mcp` (`mode` + `codeMode` provider) so code mode can be
  plugged in without `@mantlejs/mcp` taking on any sandbox dependency. Existing deployments see zero behavior
  change.
- Default sandbox: QuickJS compiled to WASM (`quickjs-emscripten-core`, sync build). No native build, it runs anywhere Node runs
  (including Cloud Run and serverless), and it enforces memory, time, call-count, and output limits. It sits
  behind a pluggable `CodeExecutor` interface.
- Prove that code mode and tool mode can't diverge. Both are generated from the same `describe()` metadata, and
  both get identical accept/reject decisions from the same hook chain.
- Ship a shadcn registry of Mantle UI blocks built on React Aria Components + Tailwind v4 + `@mantlejs/react`:
  - auth (local forms + the 7 OAuth providers)
  - storage (dropzone)
  - data (realtime list/table, `Paginated<T>` pagination, sort, search)
- Assert accessibility per block with automated axe checks, rather than assuming it from the React Aria base.
- Move `examples/knowledge-base/web` off its hand-rolled `components/ui/*` and onto the registry, making it the
  registry's first real consumer.
- Ship the Mantle website on Astro Starlight:
  - authored guides
  - package READMEs pulled in at build time
  - a generated API reference
  - the hosted registry
  - live block demos
  - `llms.txt`
- Make `CLAUDE.md`'s package dependency matrix actually enforced: tag every Nx project, and replace the root
  `eslint.config.mjs` wildcard `depConstraints` with one constraint per matrix row (spec 15, Decision #14).
- Publish via the existing `nx release` pipeline and deploy the website.

### Non-Goals (Phase 7)

Moved to the [Phase 8 backlog](./mantle-js-phase-8-backlog.md):

- `KnexTimeSeriesRepository`
- `@mantlejs/arangodb`
- GraphQL transport, rate limiting plugin, multi-tenancy primitives, Vue/Svelte/Solid/Angular bindings,
  Neptune/Cosmos adapters

Explicitly out of scope for this phase's own features:

- **A Radix (or Base UI) variant of the UI blocks.** React Aria only. One base keeps the test matrix and the docs
  single-track.
- **An npm-published `@mantlejs/ui` package.** Blocks are copy-in source (see
  [Decisions](#architectural--design-decisions) #2).
- **Persistent or stateful sandbox sessions.** Each `execute` call gets a fresh context. No variables, modules, or
  handles carry over between calls.
- **Network, filesystem, or timer access from inside the sandbox.** The only I/O is the bridged `mantle.*` API.
- **Arbitrary npm imports inside agent scripts.** The script runs against `mantle.*` and the language built-ins
  only.
- **A `--ui` or `--mcp-code` scaffold option in `create-mantlejs`.** Revisit once both have shipped and settled.
- **Studio/dashboard UI, multi-tenant control plane.** These stay outside the monorepo, per the
  [Phase 6 PRD](./mantle-js-phase-6-prd.md#non-goals-phase-6).

---

## Delivery Sequence

Phase 7 runs in four stages:

1. **Verify & foundations.** Two spikes run before any build work:
   - shadcn's React Aria base and registry mechanics
   - QuickJS's async host bridge and limit enforcement

   Then the `@mantlejs/mcp` extension point. Both spikes follow Phase 6 spec 12's precedent: verify the external
   mechanics first, record the findings in [Decisions](#architectural--design-decisions), then build. Both
   technologies are moving fast, and the PRD's assumptions about them should be confirmed rather than trusted.

2. **Build.** `@mantlejs/mcp-code` and the UI registry are independent of each other and can run in parallel.
   Each ends with its `examples/knowledge-base` integration.
3. **Website.** Sequenced after Stage 2 because it hosts the registry, demos the blocks, and documents code mode.
   Scaffolding and the content pipeline can start earlier, in parallel, if convenient.
4. **Release.** Version and publish the packages, then deploy the site.

---

## Phase 7 Specifications

### Part A — MCP code mode

#### 1. `@mantlejs/mcp` extension point

An additive change to a stable package. It adds two new `McpOptions` fields (`packages/mcp/src/lib/types.ts`):

- `mode?: "tools" | "code" | "both"`
  - `"tools"`: today's behavior, one tool per exposed method.
  - `"code"`: only the code-mode provider's tools and resources.
  - `"both"`: the union of the two.

  The default is `"code"` when a `codeMode` provider is configured, and `"tools"` otherwise. Existing
  deployments without a provider are unaffected.

- `codeMode?: McpCodeModeProvider` — an interface **defined in `@mantlejs/mcp`** and implemented by
  `@mantlejs/mcp-code`. The dependency points from `mcp-code` to `mcp`, never the reverse. This is the same
  pattern as `@mantlejs/auth-oauth`'s interfaces being implemented by the per-provider packages.

At server build time (`listen()`/`startMcp()`), the provider receives:

- the **resolved** expose map, after the existing `"*"`/`true` expansion and unknown-path validation
- the `ServiceHandle.describe()` output for each exposed service
- the effective `McpQueryOptions` (find-limit clamp)

It returns `McpToolDefinition[]` and `McpResourceDefinition[]`, the same shapes app-authored `tools`/`resources`
already use. Collision rules carry over unchanged: a provider tool name that collides with a generated or custom
tool fails the boot with a `BadRequest`.

`mode: "code" | "both"` without a provider fails the boot with a `BadRequest`, the same fail-loud style as an
unknown expose-map path.

To keep tool mode and code mode from drifting, the schema-building helpers in `packages/mcp/src/lib/tools.ts` and
`query-schema.ts` (input schemas per method, the operator-constrained `where` schema, destructive-operation notes)
are exported for providers to reuse rather than duplicated. The same principle as
[Phase 6 Decision #4](./mantle-js-phase-6-prd.md#architectural--design-decisions): one implementation for
adjacent concerns.

**Accept:**

- Every existing `@mantlejs/mcp` spec stays green, unmodified.
- New specs cover:
  - each `mode` value
  - the default resolution with and without a provider
  - provider/tool-name collision → `BadRequest`
  - `mode: "code"` without a provider → `BadRequest`
  - the provider receives the resolved expose map, never `"*"`
- The README gains a "Code mode" section that points to `@mantlejs/mcp-code`.

#### 2. Typed API generation (`@mantlejs/mcp-code`)

Generates a TypeScript declaration module from the same inputs the per-method tools use:

```typescript
/** Mantle API — every call runs the service's full hook pipeline as the current session. */
declare const mantle: {
  articles: {
    /** Returns at most 100 records (default 25). Page with `skip`/`limit`; trim fields with `select`. */
    find(query?: ArticlesQuery): Promise<Article[] | Paginated<Article>>;
    get(id: Id): Promise<Article>;
    create(data: ArticleCreate): Promise<Article>;
    /** Destructive: permanently deletes the record. */
    remove(id: Id): Promise<Article>;
    publish(data: { articleId: string }): Promise<Article>; // custom method
  };
};
```

- **Entity, create, and patch types** come from each service's attached TypeBox/JSON schema. Services without a
  schema get `Record<string, unknown>`, matching tool mode's generic-object fallback.
- **The `where` type** is narrowed to the adapter's `describe().capabilities.operators`. An agent writing code
  against an adapter without `$ilike` doesn't see `$ilike` in the types, just as it isn't offered in tool mode's
  JSON schema.
- **Only exposed methods appear**, with custom methods included. A path with an awkward identifier (`blog-posts`,
  nested paths) is used **verbatim** as the key (`mantle["blog-posts"]`, `mantle["admin/reports"]`), with no camel-cased alias.
  Type names are PascalCase, with a numeric suffix on collision ([Decision #15](#architectural--design-decisions)).
- **Agent narrowing:** when the session's bearer token is an `AgentPrincipal` token, the declarations shown to that
  session are filtered by `matchesCapabilityScope`. Session params don't carry `HookContext.agent`, so the scope is
  resolved from `params.headers.authorization` through the duck-typed `app.get("auth")` engine
  ([Decision #16](#architectural--design-decisions)). `matchesCapabilityScope` lives in
  `packages/mantle/src/lib/capability-scope.ts`. Narrowing affects only what the agent sees. Enforcement stays in
  the hook pipeline: `authorizeAgent()` still runs on every inner call, so a script that guesses at a hidden
  method still gets a `Forbidden`.
- **Size discipline:** the generator emits a short header (the `mantle` object, the shared `Id`/`Paginated`/query
  types) and one block per service, so `search_api` can return a subset.

**Accept:**

- Snapshot specs of the generated declarations for a fixture app (schema/no schema, custom method,
  operator-narrowed `where`, awkward path name).
- A spec compiles the generated output with the TypeScript compiler API, with zero diagnostics.
- Agent-scope narrowing spec: the declarations for an agent session omit out-of-scope methods.
- A drift spec: for every exposed method, the code-mode parameter type and the tool-mode JSON input schema come
  from the same exported helper.

#### 3. Tools — `search_api` and `execute`

With `mode: "code"`, the agent sees exactly two tools plus one resource:

| Surface                           | Shape                                                      | Purpose                                                                                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_api` tool                 | `{ query?: string; paths?: string[] }` → declaration text  | Load only the relevant part of the API. A keyword match over service paths, method names, and doc comments. With no arguments it returns the header plus a one-line index of the services |
| `execute` tool                    | `{ code: string }` → `{ result, logs, calls, truncated? }` | Runs the script. `result` is the script's return value (JSON-serialized), `logs` is the captured `console.*` output, and `calls` is a count/summary of bridged service calls              |
| `mantle://code/api.d.ts` resource | full declaration module                                    | For clients that load resources as context up front                                                                                                                                       |

- **The script contract:** the body of an async function. `return` sends back the result and top-level `await`
  works. The tool description includes a short worked example.
- **Errors inside the script.** A rejected bridged call raises an `Error` inside the sandbox whose properties
  carry `MantleError.toJSON()` (`name`, `message`, `code`, `data`, `hint`). The script can catch it and branch on
  `e.name === "Forbidden"`. An uncaught error, a timeout, or a limit breach becomes an MCP **tool error** with the
  same `toJSON()` shape tool mode already returns. Limit breaches use a typed `MantleError` subclass, never a
  plain `Error`.
- **Output limits:** `result` and `logs` are capped by byte size. Truncation comes with a note telling the agent
  to return less, aggregate in-script, or page, in the same style as tool mode's find-limit clamp note.

**Accept:**

- Specs for:
  - the `search_api` keyword and path filters
  - the no-argument index
  - an `execute` happy path (multi-call script, aggregation, return value)
  - log capture
  - a caught `MantleError` inside the script
  - an uncaught error → tool error shape
  - truncation with the note
- A spec showing that `mode: "code"` lists only these two tools in `tools/list`.

#### 4. Sandbox executor

```typescript
interface CodeExecutor {
  execute(code: string, bridge: CodeBridge, limits: CodeLimits): Promise<CodeExecutionResult>;
}
```

- **Default `quickJsExecutor()`** (amended by the spike, [Decision #12](#architectural--design-decisions)).
  - Uses QuickJS's **sync** WASM build: `quickjs-emscripten-core` + `@jitl/quickjs-wasmfile-release-sync`. It does
    _not_ use the `quickjs-emscripten` umbrella package (~7 MB, all four variants) or the asyncify build.
  - Host calls are bridged as guest promises (`ctx.newPromise()` deferreds, settled host-side, then
    `runtime.executePendingJobs()`), so `await` and `Promise.all` work in the guest and bridged calls run
    concurrently.
  - The asyncify build is rejected: it serializes bridged calls, throws `Already suspended` when two executions
    share a module, and crashed the process in the spike.
  - The `WebAssembly.Module` is compiled once. **Each execution gets a fresh WASM instance with its own bounded
    `WebAssembly.Memory`**, at 0.66 ms median. This is required because:
    - It's the only hard memory cap (see Limits).
    - It returns memory after a bomb, since linear memory never shrinks while an instance lives.
    - It contains an instance killed by a host-stack overflow.
  - Executor hygiene, all part of the conformance suite:
    - Dispose pending deferreds before the context. Otherwise the WASM module aborts and is dead for every later
      call.
    - Treat any host-side exception out of the WASM code (`RangeError`, internal abort) as a fatal executor fault,
      surfaced as a typed `MantleError` subclass, with that instance discarded.
    - Capture the raw bridge function inside the prelude and delete it from `globalThis`.
    - Run the script wrapper in strict mode, so writes to the frozen `mantle` object throw instead of failing
      silently.
- **The bridge:** `mantle.<path>.<method>(…)` maps to
  `app.service(path).dispatch(method, data, id, params)`:
  - `params` is the MCP session's `params`, with `provider: "mcp"`, the resolved `user`, the `agent` where
    present, and the `authorization` header passed through, exactly as tool mode builds them.
  - `params.mcp = { mode: "code", executionId }`.
  - Values cross the boundary as JSON. No host object references enter the guest.
  - Find-limit clamping applies to bridged `find` calls exactly as in tool mode.
- **Unexposed methods are unreachable.** The bridge only contains methods in the resolved expose map. That map is
  the sandbox's hard boundary: calling anything else fails as an ordinary missing property inside the sandbox and
  never falls through to `app.service()`. _Amended by [Decision #16](#architectural--design-decisions):_
  agent narrowing hides methods from the declarations only. An exposed but out-of-scope method stays callable, so
  the call reaches `authorizeAgent()` and fails with the same catchable `Forbidden` as tool mode. Enforcement
  stays in one place (Decision #8).
- **Limits** (`CodeLimits`, each configurable; defaults from the spike, [Decision #13](#architectural--design-decisions)):

  | Limit             | Default | Enforcement                                                                                                                                                                                                            |
  | ----------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `timeoutMs`       | 10 000  | Interrupt handler (CPU loops) **and** a host-side `Promise.race` timer (a bridged call that never resolves)                                                                                                            |
  | `memoryBytes`     | 32 MB   | QuickJS `setMemoryLimit`. **Soft:** the spike showed it undercounts some allocations (`Array(1e5).fill` grew memory to 2 GB under an 8 MB limit)                                                                       |
  | `wasmMemoryBytes` | 64 MB   | Bounded `WebAssembly.Memory` `maximum`. **The hard cap:** the same bomb failed cleanly at the cap in 79 ms, with RSS around 130 MB                                                                                     |
  | `stackBytes`      | 192 KB  | QuickJS `setMaxStackSize`. QuickJS runs on Node's native stack, so this must stay under about ¼ of the host thread's stack (~256 KB on the ~984 KB main thread). Above that, deep recursion overflows the _host_ stack |
  | `maxCalls`        | 50      | Bridge counter per execution                                                                                                                                                                                           |
  | `maxOutputBytes`  | 64 KB   | Applied separately to the JSON result and to captured logs                                                                                                                                                             |

- **No ambient capabilities:**
  - no `fetch`, `XMLHttpRequest`, `WebSocket`
  - no `require`/`import`, `process`, filesystem
  - no `setTimeout`/`setInterval`
  - `Date`/`Math.random` stay at their QuickJS defaults
- **TypeScript input** ([Decision #13](#architectural--design-decisions)): agents often write TS when shown a
  `.d.ts`, so TS is accepted and its types stripped host-side with Node's `module.stripTypeScriptTypes`.
  - The code is wrapped in `(async () => {…})` _before_ stripping, because the stripper rejects a top-level
    `return`. The wrapper is then sliced back off.
  - Stripping replaces types with whitespace, so line and column numbers are preserved and plain JS passes through
    unchanged (~0.07 ms).
  - The function is feature-detected, since it only exists from Node 22.13. Below that, input is JS-only and a TS
    syntax error becomes a `BadRequest`.
  - `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` (`enum`, `namespace`) maps to `BadRequest` with a hint.
  - The `ExperimentalWarning` is suppressed or documented.
  - No bundled stripper. Type _checking_ agent code is out of scope; errors surface at runtime as normal.

- **Pluggable:** `codeMode({ executor })` accepts any `CodeExecutor`, for example an `isolated-vm`- or
  Worker-backed executor someone writes later. The bridge and limit semantics are part of the interface contract,
  and there's a shared conformance spec suite (exported, like `NESTED_QUERY_CASES`) that any executor can run.

**Accept:**

- Executor conformance suite, run against `quickJsExecutor`:
  - bridge round-trip
  - JSON-only values
  - async calls in sequence and in parallel (`Promise.all`)
  - fresh instance per execution (a global set in one call is absent in the next)
  - many concurrent executions, each isolated
  - timeout while a bridged call is pending: the deferred is disposed cleanly, and the next execution still works
- Escape specs: `process`, `require`, `fetch`, `import("fs")`, the raw bridge function, `globalThis` host leakage,
  and `Function`-constructor tricks (including via `mantle.x.y.constructor.constructor`) reach no host capability.
- Limit specs. Each fails with a typed error, and the host process survives every one:
  - `while(true){}` is stopped by the deadline
  - a never-resolving bridged call is stopped by the host timer
  - an array bomb is stopped by the WASM memory cap
  - deep recursion is stopped by the stack limit
  - a configured stack above the safe ceiling becomes a contained executor fault, not a crash
  - a call-cap breach
  - an oversized result

#### 5. Security, equivalence, agent scope, audit

These carry the no-bypass guarantee over to code mode:

- **Hook-pipeline equivalence.** Extend `packages/mcp/src/lib/hook-pipeline-equivalence.spec.ts`'s pattern
  (one service, real `authenticate("jwt")` + an authorization hook; no credentials, wrong role, right role) to
  three channels: HTTP, MCP tool mode, and MCP code mode. All three get identical accept/reject decisions.
  `HookContext.provider` is `"mcp"` for both MCP channels, and code mode additionally carries `params.mcp.mode`.
- **Agent scopes.** With an `AgentPrincipal` session:
  - an in-scope call inside a script succeeds
  - an out-of-scope call (forced by hand-constructing the call against a method that _is_ exposed but not
    in-scope) throws a catchable `Forbidden` whose shape matches `authorizeAgent()`'s denial
  - narrowing (spec 2) hides the method from the declarations
- **Audit.** With `@mantlejs/audit` attached, a script making N service calls produces exactly N audit records,
  all carrying the same `executionId`. "What did this script do" is one `find()` on the audit sink. Every
  bridged call carries `params.mcp = { mode, executionId, scriptHash }`, which `@mantlejs/audit` records as
  `AuditRecord.mcp`. The full script source is included only with `auditScriptSource: true`, because scripts can
  embed data ([Decision #17](#architectural--design-decisions)).

**Accept:** the three spec groups above are green.

#### 6. Example and docs

- `examples/knowledge-base/api` gains a code-mode MCP entry point next to (not replacing) its existing MCP setup,
  plus a README walkthrough. One example task, "find the 5 most-recently updated articles tagged X and summarize
  their titles", takes one `execute` call instead of several tool round trips.
- The `@mantlejs/mcp-code` README covers:
  - quick start
  - the `mode` table
  - script contract
  - limits and their defaults
  - the security model: what the sandbox can and can't do, and why the hook pipeline is still the authority
  - writing a custom `CodeExecutor` + running the conformance suite
  - when to prefer tool mode (small APIs, clients that can't write code well)

**Accept:** the example boots and the walkthrough's script runs end to end. The README quick start is
copy-paste-correct (verified the same way Phase 6 verified the adapter READMEs during promotion).

### Part B — Mantle UI registry

#### 7. shadcn React Aria base + registry mechanics — spike

Before building any blocks, verify against current shadcn docs and CLI and record the findings in
[Decisions](#architectural--design-decisions):

- How the React Aria base is selected (`shadcn init` flag, `components.json` field, or style name), and which
  primitives it provides as registry dependencies (button, text field, dialog, table, …), so blocks can declare
  them via `registryDependencies` instead of vendoring their own.
- The current registry item schema (`registry.json`, `registry-item.json`), the `shadcn build` output format, and
  how a namespaced registry (`@mantle/…`) is declared in a consumer's `components.json`.
- Tailwind v4 + CSS-variable theming expectations for the React Aria base, so blocks inherit the consumer's theme.
- Where the registry project lives (`registry/` at the root vs. `packages/ui-registry`) and its Nx tags.

**Accept:** findings are recorded as a Decisions row, and any PRD assumption the findings contradict is amended
in this document before item 8 starts.

**Done (2026-10-07):** recorded as [Decision #11](#architectural--design-decisions). Checked against
`shadcn@4.21.4` and a scratch prototype. The prototype went end to end: `init --base aria` → build a one-block
`@mantle` registry → `shadcn add @mantle/login-form` from a local URL → `npm run build`. Three corrections were
applied below:

- Specs 9–10: blocks import the React Aria pieces shadcn doesn't wrap directly.
- Spec 8: blocks require an `aria-*` style.
- Spec 8: exact smoke-test `init` flags, plus an upstream `label.tsx` workaround.

#### 8. Registry project + build pipeline

- An **unpublished** Nx project at **`registry/`** (repo root).
  - Private npm workspace with Nx name `ui-registry`. It goes at the root rather than under `packages/*` because
    it's never published, like `examples/*`.
  - Holds the block sources, `registry.json`, and a `build-registry` target that runs `shadcn registry validate`
    then `shadcn build`, emitting `public/r/*.json`.
  - It's also a working `aria-*` shadcn project in its own right (its own `components.json`, base primitives under
    `@/components/ui`, a `@/` path alias), so blocks type-check and test in place. shadcn's own repo is set up the
    same way.
- Boundary: may depend on `@mantlejs/client` and `@mantlejs/react` only (the same row as `@mantlejs/react`), plus
  peer `react`, `react-aria-components`, `@tanstack/react-query`. Tags are `type:registry` and `scope:ui`.
  - The repo currently has **no** Nx tags, and the root `eslint.config.mjs` `depConstraints` is a wildcard. So
    real enforcement means tagging `client`/`react` too and adding one constraint.
  - Repo-wide tagging to back `CLAUDE.md`'s dependency matrix is a separate gap. It's noted here but not fixed by
    this spec.
- **Blocks require an `aria-*` style.**
  - Bare `registryDependencies` (`"button"`, `"input"`) resolve to the consumer's own style.
  - A consumer on a Radix or Base UI style would get a non-React-Aria `Input`, which breaks inside a React Aria
    `TextField`.
  - This item picks how to enforce or document the requirement: a `{style}`-templated registry URL, an
    install-time note, or both. It also tests what actually happens on a non-aria style.
- A **registry install smoke test**, modeled on `packages/create-mantlejs/e2e/scaffold-smoke.mjs`:
  1. Run
     `shadcn init --template vite --base aria --preset <name> --no-monorepo --yes`. `--preset` is required;
     without it, init stops at an interactive prompt.
  2. Add `"registries": { "@mantle": "http://localhost:<port>/r/{name}.json" }` to `components.json`.
  3. Run `shadcn add @mantle/<block>` for every block.
  4. Type-check and build.

  Additional requirements:
  - Run against **at least two presets** (e.g. `nova`, `vega`), since blocks must look right under any of them.
  - Pin the `shadcn` CLI version.
  - Handle the upstream bug in shadcn's aria `label.tsx`: an unused `import * as React` fails `tsc` with TS6133
    under the Vite template's `noUnusedLocals`. Work around it in the test, or drop the workaround once it's fixed
    upstream.
  - Wire the test into CI next to the existing `e2e-scaffold` job.

**Accept:** `build-registry` emits valid JSON for every block, and the smoke test passes locally and in CI on
every tested preset.

#### 9. Auth blocks

- `login-form`: email/password against `@mantlejs/auth-local`, plus typed error display (`NotAuthenticated`,
  `BadRequest` field errors).
- `signup-form`
- `oauth-buttons`: all 7 OAuth providers (Google, GitHub, Facebook, Apple, Microsoft, LinkedIn, X). Each button links
  to the provider's `@mantlejs/auth-oauth` redirect route and follows provider brand guidelines for label and
  iconography.
- `auth-provider` + a `useAuth()` hook built on `@mantlejs/client`'s auth calls (current user, logout, token
  refresh behavior documented).

Built from React Aria `Form` and `TextField`, imported directly from `react-aria-components`. shadcn's aria
registry has no `TextField` wrapper, and its `form` item is an empty stub. They're combined with shadcn's aria
`input`/`label`/`field`/`button` via `registryDependencies` and React Aria's built-in field-level validation,
so errors are announced to assistive tech.

**Accept:**

- Vitest + Testing Library specs per block against a mocked client: happy path, typed error rendering, and
  keyboard-only operation.
- axe checks (`vitest-axe` or equivalent) with zero violations per block in each rendered state.

#### 10. Storage and data blocks

| Block               | React Aria basis              | Mantle wiring                                                                                                                                  |
| ------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `upload-dropzone`   | `DropZone` + `FileTrigger`    | `@mantlejs/storage` upload endpoint; progress, size/type limits, typed error display                                                           |
| `realtime-list`     | `GridList`                    | `@mantlejs/react` live query; created/patched/removed events update in place                                                                   |
| `data-table`        | `Table` (+ sortable `Column`) | `find` with `QueryParams.sort` driven by column sort descriptors; `select` from visible columns                                                |
| `mantle-pagination` | `Button` group / `Link`s      | Reads `Paginated<T>` (`total`/`limit`/`skip`) and drives `skip`                                                                                |
| `search-combobox`   | `ComboBox`                    | Debounced `find`; uses `$ilike` when the service's capabilities advertise it, `$like` otherwise (the capability matrix in `CLAUDE.md` decides) |

shadcn's aria registry wraps `Table`, `ComboBox`, and pagination (the last is link-buttons only). It does
**not** wrap `DropZone`, `FileTrigger`, `GridList`, or `ListBox`. Blocks import those directly from
`react-aria-components` and style them with the theme's semantic tokens (`bg-primary`, `text-muted-foreground`,
…), never fixed palette colors, so they follow the consumer's theme and preset.

**Accept:** the same spec and axe bar as item 9, plus a realtime-list spec proving that an emitted event updates
the rendered list without a refetch, and a data-table spec proving that a sort interaction produces the expected
`QueryParams.sort`.

#### 11. Retrofit `examples/knowledge-base/web`

First run `shadcn init --base aria` in the example, which adds `components.json` and the `@/` alias it doesn't
have today. Then replace the hand-rolled `src/components/ui/{button,card,input,textarea}.tsx` with registry
installs (React Aria base primitives). The current hard-coded `bg-slate-*` styling gives way to theme tokens.
Also replace any hand-rolled auth/upload/list UI with the matching Mantle blocks. This is the
real-consumer check the backlog item asked for.

**Accept:** the example builds and behaves the same as before (same flows, no regressions). The README describes
how the UI was installed (`shadcn add …` commands) so the example doubles as registry documentation.

### Part C — Website

#### 12. Starlight site + content pipeline

- An **unpublished** app at `website/`, exempt from the package boundary rules the same way `examples/*` is, and
  never depended on.
- **Authored guides:**
  - getting started
  - architecture (the layer model, "why Mantle vs FeathersJS")
  - adapters and the capability matrix
  - auth
  - agents (MCP tool mode vs code mode, agent identity, audit)
  - storage
  - realtime
  - deployment (Cloud Run)
- **Package READMEs pulled in at build time** via an Astro content loader. The READMEs stay the source of truth
  and nothing is copied by hand, so documentation can't drift between npm and the site.
- **API reference** generated from the emitted `.d.ts` (TypeDoc via a Starlight integration, with the exact
  plugin picked in the item).
- **`llms.txt` / `llms-full.txt`**, generated from the same content, for agents reading Mantle's docs.
- **Doc-versioning policy:** "docs track `latest`" is the expected default at `0.x`. The policy is recorded in
  Decisions.

**Accept:**

- The site builds in CI.
- An internal link check passes.
- Every published `@mantlejs/*` package has a reference page.
- `llms.txt` is generated.
- Editing a package README and rebuilding changes the site. Ingestion is proven live, not as a one-time copy.

#### 13. Registry hosting, live demos, deploy

- Serve the registry's `r/*.json` from the site, at `/r/`.
- Live block demos as React islands against a **mocked client transport**, so there's no live backend dependency
  and nothing to secure or keep running.
- Decide the domain (`mantlejs.com` vs `mantlejs.org`; the backlog and the Phase 6 PRD disagree) and the hosting
  target (a static host vs Cloud Run serving static files). Record both in Decisions.
- CI deploys on release (and optionally on `main` for docs-only changes, also decided here).

**Accept:**

- The deployed site is reachable.
- `npx shadcn add https://<domain>/r/login-form.json` works against the deployed URL in a fresh app.
- Every block page renders a working demo.

### Part D — Release

#### 14. Release + post-release verification

See [Release Plan](#release-plan).

**Accept:**

- All Phase 7 packages are live on npm at their tier's version.
- The site is deployed and the registry is reachable.
- `CLAUDE.md` (monorepo tree, dependency matrix) and the root README packages table are updated.
- The post-release verification pass matches the depth of Phase 6 item 9's: install each new or changed package
  from npm in a clean project and run its README quick start.

### Part E — Repo hygiene

#### 15. Enforce the package dependency matrix _(found by the spec 7 spike)_

`CLAUDE.md` says its package dependency matrix is "enforced by `@nx/enforce-module-boundaries`", but today:

- No Nx project in the workspace has tags.
- The root `eslint.config.mjs` has a single wildcard constraint
  (`{ sourceTag: "*", onlyDependOnLibsWithTags: ["*"] }`).

So the rule only catches deep or relative cross-project imports and circular dependencies. It never checks the
matrix. A package could import any other package and lint would pass. Fix that before Phase 7 adds `mcp-code`
and `registry`, so both new projects land under real constraints instead of being retrofitted.

- **Tag every project:**
  - `pkg:<name>` on each of the 39 `packages/*` projects plus `mcp-code`.
  - A coarse kind tag: `type:lib` for the published packages, `type:registry`, `type:app` for `examples/*` and
    `website/`, and `type:tool` for anything under `tools/`.
  - Tags go in each project's `package.json` `nx.tags`, matching how these projects are already configured.
    Generated `project.json`/`package.json` fields stay as they are, per `CLAUDE.md`.
- **One `depConstraints` entry per matrix row**, e.g.
  `{ sourceTag: "pkg:auth-local", onlyDependOnLibsWithTags: ["pkg:mantle", "pkg:auth"] }`.
  - `type:app` → `["*"]`, which keeps `examples/*` and `website/` exempt as the matrix already states.
  - `pkg:mantle` and `pkg:cli` get an empty allow-list ("nothing").
  - `registry` → `pkg:client`, `pkg:react`.
- **Dev-only exceptions stay narrow.** The matrix allows `@mantlejs/client` a dev-only dependency on
  `@mantlejs/mantle` for conformance specs. Express that with a separate override scoped to `**/*.spec.ts(x)`
  files, so production sources stay strictly constrained. The same goes for any other existing spec-only
  cross-package imports the rollout turns up. Each exception is listed in the PRD's Decisions, not hidden by
  widening a constraint.
- **Violations found when the constraints are switched on get fixed, not allow-listed**, unless the matrix itself
  is wrong. In that case `CLAUDE.md`'s matrix is corrected in the same change and the reason is recorded.
  Phase 6 item 1's rule applies: no drift between what's documented and what's enforced.
- Additive to the existing Nx-generated config, per `CLAUDE.md`: the constraint block is extended, and nothing
  else in `eslint.config.mjs` is rewritten.

**Accept:**

- Every project carries its tags.
- The root `depConstraints` mirrors `CLAUDE.md`'s matrix row for row. A spec or script cross-checks the two, so
  future matrix edits can't silently diverge from config.
- A deliberate forbidden import in a scratch change (e.g. `@mantlejs/auth` importing `@mantlejs/knex`) fails
  `nx lint`, and is then reverted. This proves the rule actually fires.
- `npx nx run-many -t lint` is green across the workspace with the real constraints on.
- `CLAUDE.md`'s "enforced by" claim is now true, and its matrix gains rows for `mcp-code` and `registry` when
  those land.

---

## Release Plan

Builds on the pipeline Phase 5 built and Phase 6 exercised. No new tooling is expected.

- **`@mantlejs/mcp-code` joins the existing `experimental` fixed group** in `nx.json`, alongside `audit` and
  `embeddings`. Per Phase 6 Decision #3 (as amended), a new package doesn't go straight to stable, and its first
  version follows the group's current-cycle version (`{stable version}-experimental`), never a hardcoded literal.
- **`@mantlejs/mcp` takes a stable minor bump** for the extension point (additive). `@mantlejs/mcp-code` peers on
  that minimum `@mantlejs/mcp` version. Check that `tools/bump-peer-ranges.mjs` covers a peer range that crosses
  groups (experimental → stable). `mcp-code` currently peers on `^0.2.0`, but the published `@mantlejs/mcp`
  0.2.0 has no extension point, so this bump is **required**, not just tidying.
- **Code-mode follow-ups found during items 4–7** (fix before release, or record as known issues):
  - `@mantlejs/mcp`'s server passes string tool results through `JSON.stringify`, so `search_api` declarations
    arrive as a quoted string with escaped newlines. That works, but it wastes tokens. Pass strings through
    unquoted.
  - Configuring `mcp()` twice on one app (as the example does for `/mcp` and `/mcp-code`) works over HTTP, but
    the second call overwrites `app.get("mcp:server")`. Only `startMcp()` over stdio is affected.
- **Client-SDK follow-ups found during items 8–11** (the blocks work around these; decide before release whether to
  fix in `@mantlejs/client`/`@mantlejs/react` or record them as known issues):
  - ~~**Bug:** `@mantlejs/client`'s `authenticate()` accepts a 200 response with no `accessToken`.~~ **Fixed (2026-10-08, `fe31721`):** `authenticate()` now throws a `GeneralError` and stores and emits nothing. The same hole in the 401-refresh path now counts as a failed rotation. `setTokens()` rejects an empty token.
  - ~~`@mantlejs/client` has no multipart upload support and doesn't expose `baseUrl`.~~ **Fixed (2026-10-08):**
    - New `ServiceClient.upload(file, { id?, field?, fields?, filename?, onProgress?, signal?, headers? })`.
      - It sends `POST /:service`, or `PATCH /:service/:id` with `id`, as `multipart/form-data`.
      - It goes through the client's bearer auth, one refresh-and-retry on 401 (the body is rebuilt for the retry),
        and typed errors.
      - It uses `XMLHttpRequest` when `onProgress` is set and XHR exists (looked up structurally, since the package
        compiles without the DOM lib), and `fetch` otherwise.
      - It's never batched.
    - New `MantleClient.url` getter.
    - `upload-dropzone` now takes `service` (+ optional `id`) instead of an absolute `url`, and calls
      `service.upload()`. Its private XHR code is gone.
  - ~~`@mantlejs/react`'s `realtime: true` always invalidates and refetches.~~ **Fixed (2026-10-08):**
    - `useFind` accepts `realtime: { mode: "patch", idField?, matches?, insert? }`. Events are written into that
      hook's own cache entry with no refetch, and a `Paginated<T>` envelope's `total` stays in step.
    - A changed record that stops or starts matching is removed or inserted.
    - Missed events are still recovered by the provider's invalidate-on-reconnect.
    - `realtime-list` now uses it, and its private cache-writing code is gone.
  - **Release coupling (required):** both fixes are new API in `@mantlejs/client`/`@mantlejs/react`, so the
    `upload-dropzone`/`realtime-list` blocks only work against the next release.
    - The blocks' `registry.json` `dependencies` currently name `@mantlejs/client`/`@mantlejs/react` with no
      range. They must be pinned to the release that ships these APIs (e.g. `"@mantlejs/client@^0.3.0"`) when
      that version is cut.
    - The site/registry must not be deployed before that release is on npm.
    - The install smoke test isn't affected, because it installs `npm pack` tarballs of the workspace build.
  - Service capabilities (`describe().capabilities`) aren't reachable over HTTP, only as prose in the OpenAPI
    description. That's why `search-combobox` probes for `$ilike` (Decision #20). Exposing capabilities to clients
    would remove the probe.
- **Tier-list review for `audit` and `embeddings`:** Phase 7's release is the first chance to promote them. Apply
  the same per-package bar as Phase 6's Adapter Promotion Plan. A package that doesn't clear it stays
  experimental.
- **The registry and the website aren't on npm.** They're versioned by deploy. The registry's block code pins the
  `@mantlejs/client`/`@mantlejs/react` ranges it was tested against in each item's `dependencies`.
- **`examples/*` exact-pin audit** before `nx release version`, the same proactive check as in Phase 6.
- **CI:** a new job for the registry install smoke test, and a site build + deploy job. Node 22 stays.

---

## Package Structure Additions

```text
mantle/
├── packages/
│   ├── [all Phase 1–6 packages]
│   └── mcp-code/         @mantlejs/mcp-code    [NEW P7 — experimental]
├── registry/             Mantle UI shadcn registry (unpublished, Nx name ui-registry; Decision #11)
├── website/              Astro Starlight site (unpublished, deploy-only)
└── examples/             [unchanged set; knowledge-base gains code mode + registry UI]
```

### Updated Package Dependency Rules (Phase 7 additions)

| Package                  | May depend on                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `@mantlejs/mcp-code`     | `@mantlejs/mantle`, `@mantlejs/mcp` (+ `quickjs-emscripten-core`, `@jitl/quickjs-wasmfile-release-sync`) |
| `registry` (unpublished) | `@mantlejs/client`, `@mantlejs/react` (peers: `react`, `react-aria-components`, `@tanstack/react-query`) |
| `website` (unpublished)  | anything (app, exempt like `examples/*`, never depended on)                                              |

The only change to an existing package is `@mantlejs/mcp`'s new _exported_ types and helpers. Its allowed
dependencies don't change.

---

## Success Metrics

- An agent connected in code mode completes a multi-step task over the knowledge-base example (filter, join
  across two services, aggregate) in **one `execute` call**, where tool mode needs several round trips. The tool
  definitions in context shrink from one-per-method to two.
- HTTP, MCP tool mode, and MCP code mode get **identical** accept/reject decisions from the same hook chain. Zero
  bypass paths, proven by spec.
- Every bridged call from a script produces exactly one audit record, correlated by `executionId`.
- No sandbox escape or limit breach crashes or hangs the host process in the conformance suite.
- Every UI block installs from the hosted registry into a fresh app, builds, and passes axe with zero
  violations.
- `examples/knowledge-base/web` contains no hand-rolled UI primitives.
- The website is live, covers every published package, serves the registry and `llms.txt`, and re-renders a
  README change on rebuild.
- `npx nx run-many -t build,test,lint,typecheck` is green across the workspace, including `mcp-code`, `registry`,
  and `website`.

---

## Architectural & Design Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Phase 7 scope is code mode + UI registry + website only. Time-series, ArangoDB, and the Phase 4 non-goal grab-bag move to a Phase 8 backlog                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | The three chosen themes reinforce each other: the site hosts the registry and documents code mode, and code mode extends the agent-native position Phase 6 established. The deferred items are new adapter surface with no current demand signal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2   | The UI is a **shadcn registry** (copy-in source), not an npm `@mantlejs/ui` package                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | This is the model shadcn and Supabase UI use. Consumers own and customize the code, there's no versioned component API to maintain as a semver contract, and it matches how `examples/knowledge-base/web` already builds UI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 3   | The UI blocks use **React Aria** as their only base                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | React Aria is now a first-class shadcn base. It brings tested keyboard, focus, ARIA, and i18n behavior, and a `DropZone`/`FileTrigger`/`ComboBox`/`Table` set that maps directly onto Mantle's storage and data blocks (some used straight from `react-aria-components` rather than via shadcn; see #11). One base keeps tests and docs single-track                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 4   | Code mode is a **separate package**, `@mantlejs/mcp-code`, plugged into `@mantlejs/mcp` through an interface `@mantlejs/mcp` defines                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Keeps the sandbox dependency (WASM, ~MBs) out of every MCP deployment. The dependency points `mcp-code → mcp`, the same shape as `auth-oauth` → per-provider packages. `@mantlejs/mcp` stays stable while `mcp-code` matures in the experimental tier                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 5   | Default sandbox is **QuickJS/WASM** (`quickjs-emscripten-core`, sync build; see #12) behind a pluggable `CodeExecutor`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | No native build or ABI coupling, so it runs on Cloud Run/serverless. It has real isolation, since the guest has no host objects. It enforces memory, time, and interrupt limits. Raw speed doesn't matter much because scripts mostly wait on bridged I/O. `isolated-vm`/Worker executors can be added later against the same conformance suite                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 6   | `mode` defaults to `"code"` when a provider is configured, and `"tools"` otherwise                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Shrinking context is the point of code mode, and `"both"` gives most of that back. Configuring a provider is an explicit opt-in, so existing deployments are unaffected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 7   | Code-mode declarations and tool-mode schemas come from **the same exported helpers** in `@mantlejs/mcp`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | The two surfaces can't drift. Same principle as Phase 6 Decision #4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 8   | Agent narrowing of the declarations is for display only. Enforcement stays in `authorizeAgent()` and the hook pipeline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | One enforcement point. Narrowing only spends fewer tokens and keeps the agent from guessing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 9   | Each `execute` gets a fresh sandbox context, with JSON-only values crossing the bridge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | No state carries between calls and no host references reach the guest. Each execution is independently auditable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 10  | Website: **Astro Starlight**, static, READMEs pulled in at build time                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Docs-first, with React islands for live block demos, a static host for the registry JSON, and no SSR framework adopted. Pulling in READMEs keeps them the single source of truth                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 11  | Spike finding (2026-10-07, checklist item 1 / spec 7): shadcn's React Aria base is real and first-class. `shadcn init --base aria --preset <nova\|vega\|maia\|lyra\|mira\|luma\|sera\|rhea>` saves the base as part of the style name (`components.json` `"style": "aria-nova"`), with no separate field. The aria registry has 60 UI items (button, input, field, label, card, dialog, combobox on React Aria `ComboBox`, table on React Aria `Table`/`Column`, pagination, progress, sonner, …) but **no** `DropZone`/`FileTrigger`/`GridList`/`ListBox`/`TextField` wrappers, and `form` is an empty stub. It brings in `react-aria-components` (`^1.22.0`), `class-variance-authority`, `cn`, `lucide-react`, `tw-animate-css`. Bare-name `registryDependencies` resolve to the _consumer's_ style. Consumers add us via `components.json` `"registries": { "@mantle": "https://<site>/r/{name}.json" }` (`{style}` also supported). `shadcn registry validate` checks `registry.json`, and `shadcn build` writes `public/r/<item>.json` with file contents inlined. Theming is Tailwind v4 CSS variables (`@theme inline` → `--primary`, `--radius`, …), and components style themselves on ARIA/data attributes. Registry project lives at root `registry/` (private workspace, Nx name `ui-registry`, tags `type:registry`/`scope:ui`) and is itself an `aria-*` shadcn project. | The PRD's base assumption holds. Three corrections, applied to specs 8–11: (1) blocks import `DropZone`/`FileTrigger`/`GridList`/`TextField`/`Form` straight from `react-aria-components`, styled only with theme tokens; (2) blocks require an `aria-*` style, because bare dependencies follow the consumer's style and a Radix `Input` breaks inside a React Aria `TextField`, so item 8 picks enforcement/documentation; (3) the smoke test must pass `--preset` (init hangs without it) and work around an upstream TS6133 unused-import error in shadcn's aria `label.tsx` under the Vite template's `noUnusedLocals`. Root `registry/` rather than `packages/*` because it's never published, like `examples/*`. Side finding: the repo has no Nx tags and a wildcard `depConstraints`, so `CLAUDE.md`'s "enforced by `@nx/enforce-module-boundaries`" claim isn't backed by tags today. Flagged, not fixed here                                                                                                                                        |
| 12  | Spike finding (2026-10-07, checklist item 2 / spec 4): the code-mode sandbox uses QuickJS's **sync** WASM build (`quickjs-emscripten-core` 0.32 + `@jitl/quickjs-wasmfile-release-sync`, ~1.4 MB), with host calls bridged as guest promises (`ctx.newPromise()` + `runtime.executePendingJobs()`), **not** asyncify. The WASM module is compiled once, and **each execution gets a fresh instance with its own bounded `WebAssembly.Memory`**. Pending deferreds are disposed before the context. Any host-side exception out of the WASM code is a fatal, typed executor fault. Amends spec 4's original "asyncify" and "reusing the compiled WASM module is fine" assumptions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Measured on Node 22.17. Asyncify serializes bridged calls (`Promise.all` of 3 × 50 ms: 161 ms vs 51 ms with the promise bridge), throws `Already suspended` when two executions share a module, then hits an internal WASM assertion failure and crashed the process. The promise bridge ran 20 concurrent executions × 3 parallel calls in 72 ms, correctly isolated. `setMemoryLimit` alone did not bound memory: an `Array(1e5).fill` bomb grew WASM memory to 2 GB and RSS to 1.65 GB under an 8 MB limit, and linear memory never shrinks while an instance lives. A bounded `WebAssembly.Memory` failed cleanly at the cap in 79 ms. A fresh capped instance costs 0.66 ms median (p95 1.53 ms), negligible next to bridged I/O. QuickJS shares Node's native stack: a QuickJS stack limit above ~¼ of the host's overflows the host and kills the instance, and a fresh instance per execution contains it. Leftover deferreds at dispose abort the module. Prototype: session scratchpad `spike-quickjs/` (`promise-executor.mjs`, `test-promise.mjs`) |
| 13  | Agent TypeScript is stripped host-side with Node's `module.stripTypeScriptTypes`, feature-detected (JS-only below Node 22.13). It runs after wrapping in `(async () => {…})`, and the wrapper runs in strict mode. Unsupported syntax (`enum`, `namespace`) → `BadRequest` with a hint. No type checking, no bundled stripper. Default `CodeLimits`: `timeoutMs` 10 000, `memoryBytes` 32 MB (QuickJS soft limit), `wasmMemoryBytes` 64 MB (hard cap), `stackBytes` 192 KB, `maxCalls` 50, `maxOutputBytes` 64 KB each for result and logs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Stripping takes ~0.07 ms, keeps line/column positions, and leaves plain JS unchanged. The stripper rejects a top-level `return` unless the code is wrapped first. Sucrase would add 1.1 MB + 7 dependencies for no gain on supported Node versions. The stack ceiling was measured at ~256 KB safe on Node's ~984 KB main-thread stack; 192 KB leaves margin and still allows 1000+ recursion frames. The 64 MB WASM cap kept peak RSS around 130 MB under a memory bomb, vs 1.65 GB uncapped. The 10 s timeout covers 50 sequential bridged calls at ~200 ms. 64 KB output caps keep a result to about 16k tokens                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 14  | Enforce `CLAUDE.md`'s package dependency matrix for real in Phase 7 (spec 15, checklist item 3a), sequenced in Stage 1 before `mcp-code`/`registry` exist. One `pkg:<name>` tag per project plus a `type:*` kind tag, one `depConstraints` entry per matrix row, `type:app` exempt, dev-only exceptions scoped to spec files, and a cross-check keeping config and matrix in sync                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | The spec 7 spike found zero Nx tags in the workspace and a wildcard `depConstraints`, so the documented "enforced by `@nx/enforce-module-boundaries`" guarantee was never true. This is the same documented-vs-enforced drift class Phase 6 item 1 fixed for adapter capabilities. Doing it before the two new projects land means they're born constrained instead of retrofitted. Approved 2026-10-07                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 15  | Code-mode API keys are service paths used **verbatim** (`mantle["blog-posts"]`), with no camelCase aliases. Type names are PascalCase with a numeric suffix on collision (`BlogPosts2Record`). Item 4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | No two paths can collide (`blog-posts` vs `blogPosts`), there's no renamed path for the agent to guess, and the key matches the tool-mode path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 16  | The code-mode agent's scope is resolved from `params.headers.authorization` through the duck-typed `app.get("auth")` engine (`verifyJwt` + `isAgentTokenValid`). If resolution fails, the agent is shown the full exposed API. Narrowing affects **display only**; the expose map is the sandbox's hard boundary. Amends spec 4's original "the bridge omits narrowed methods". Item 4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Session params don't carry `HookContext.agent`, which only exists inside the hook pipeline (item 3's Done note). Duck-typing follows `@mantlejs/mcp`'s own session-auth convention, so there's no production dependency on `@mantlejs/auth`. Keeping enforcement in one place (Decision #8) is what lets spec 5's out-of-scope call reach `authorizeAgent()` and get the same catchable `Forbidden` as tool mode. A revoked token sees the full API but is still rejected on every call                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 17  | Script audit policy: every bridged call carries `params.mcp = { mode, executionId, scriptHash }` (SHA-256 of the script). Full source only with `auditScriptSource: true` (default off). `@mantlejs/audit` gained an optional `AuditRecord.mcp`, copied from `ctx.params.mcp`. Item 6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Scripts can embed data. The hash still ties each record to its exact script, and `executionId` makes "what did this script do" one `find()`. Without `AuditRecord.mcp`, code-mode calls couldn't be grouped by script, so this was a required addition rather than optional polish                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 18  | An oversized `execute` result fails with `CodeOutputTooLarge` (413) and a hint. Oversized logs are truncated with a note. Uncaught service errors keep their class (`NotFound`, `Forbidden`, …). Script bugs and syntax errors become `CodeScriptError`. Execution details go under `data.execution`. Hitting the call cap fails the execution even if the script catches the error. Item 5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Truncated JSON is invalid data. Keeping the class makes a code-mode tool error read the same as tool mode's, and logs survive a failure for debugging. The call cap must not be catchable, or it isn't a cap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 19  | Mantle UI blocks are **aria-only, enforced at install time**. Consumers register `"@mantle": "https://<site>/r/{style}/{name}.json"`, and `build-registry` copies every item into `r/aria-<preset>/` for each of shadcn 4.21.4's 8 presets. Flat `r/<name>.json` is still published. Item 8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Observed on a radix-nova consumer with a plain `{name}` URL: `shadcn add` succeeds, then `tsc` fails with 13 TS2322/TS7006 errors in data-table, login-form and mantle-pagination. Worse, a Radix `Input` inside a React Aria `TextField` compiles but is never connected to the field. With `{style}` in the URL, the same install fails with a not-found error before any file is written, and the e2e asserts this. Cost: the preset list is hard-coded and must be updated whenever the shadcn CLI pin moves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 20  | `search-combobox` detects `$ilike` support at runtime. `operator="auto"` (the default) tries `$ilike` and falls back to `$like` per service when the adapter's `BadRequest` names the operator. That result is remembered for the page session. `"$ilike"`/`"$like"` can be pinned. Item 10                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `describe().capabilities` isn't exposed to HTTP clients (only as prose in the OpenAPI description). The `assertOperators` fail-loud contract is the one reliable signal a client can see. Other 4xx responses are never retried, so the fallback costs at most one extra request per service per page load. Superseded if capabilities are ever exposed to clients (Release Plan follow-up)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 21  | Registry conventions:<br>- shadcn's aria pagination is wrapped as `mantle-pagination`.<br>- Block files install under `components/mantle/` (+ `lib/mantle-errors.ts`).<br>- OAuth buttons are text-only ("Continue with Google"…), with no bundled provider logos.<br>- The upstream aria `label.tsx` TS6133 bug is patched in the vendored copies, and conditionally in the smoke test, which logs once it's no longer needed.<br>- Vendored `src/components/ui` otherwise stays byte-for-byte upstream.<br>- Smoke-test presets are `nova` and `vega` (overridable via `MANTLE_UI_PRESETS`).<br><br>Items 8–11                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | The rename and the install directory avoid clashing with shadcn's own bare-name `pagination` dependency and blocks. Each provider licenses its logo separately, so the README tells consumers to add official assets themselves. Pinning the CLI doesn't fix `label.tsx`, because the live aria-nova `label.json` still ships the unused import. Two presets catch preset-specific breakage without making CI too slow                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| —   | _Reserved:_ domain/hosting/versioning (specs 12–13)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Recorded here as rows 11+ when decided, the same way Phase 6 recorded its spike finding as Decision #9                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

---

## Reference

- [Phase 7 Checklist](./mantle-js-phase-7-checklist.md)
- [Phase 7 Backlog](./mantle-js-phase-7-backlog.md) — source of the UI library and website items
- [Phase 8 Backlog](./mantle-js-phase-8-backlog.md) — items deferred out of this PRD
- [Phase 6 PRD](./mantle-js-phase-6-prd.md) — agent identity, audit, tiering rules (Decisions #3, #4, #8)
- [Phase 6 Checklist](./mantle-js-phase-6-checklist.md) — hook-pipeline equivalence spec precedent (item 2)
- [`BAAS-READINESS.md`](./BAAS-READINESS.md) — the agent-native/audit-first positioning code mode extends
- [`docs/releasing.md`](../releasing.md) — publish runbook
- `@mantlejs/mcp` README (`packages/mcp/README.md`) — the tool-mode surface code mode complements
