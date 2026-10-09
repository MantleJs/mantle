# Mantle JS — Phase 7 Implementation Checklist

Work through these in order. Each item maps to a spec in the [Phase 7 PRD](./mantle-js-phase-7-prd.md). Phase 7
runs in four stages, in order:

1. Verify & foundations (items 1–3, plus 3a)
2. Build: code mode (items 4–7) and the UI registry (items 8–11). These two tracks are independent and can run in
   parallel.
3. Website (items 12–13)
4. Release (item 14)

> **Note (2026-10-06):** scope is MCP code mode (new), the Mantle UI library as a React Aria-based shadcn
> registry (backlog item 4), and the Mantle website (backlog item 3). Backlog items 1, 2, and 5 move to the
> [Phase 8 backlog](./mantle-js-phase-8-backlog.md). See the PRD's Decisions table, #1.

---

## Stage 1 — Verify & foundations

- [x] **1. Spike: shadcn React Aria base + registry mechanics** _(PRD spec 7)_
      Before building any blocks, confirm against current shadcn docs and CLI:
  - how the React Aria base is selected (init flag / `components.json` field / style name)
  - which base primitives it provides as `registryDependencies`
  - the current `registry.json`/`registry-item.json` schema and `shadcn build` output
  - how a consumer declares a namespaced registry (`@mantle/…`)
  - Tailwind v4 theming expectations

  Decide the registry project's location (`registry/` vs `packages/ui-registry`) and its Nx tags.
  **Accept:** findings recorded as a new row in the PRD's Decisions table. Any PRD assumption they contradict is
  amended in the PRD before item 8 starts.
  **Done (2026-10-07):** recorded as PRD Decision #11. Verified against `shadcn@4.21.4` with a scratch prototype.
  The full chain was exercised: `init --template vite --base aria --preset nova` → one-block `@mantle` registry
  (`registry validate` + `build`) → served locally → `shadcn add @mantle/login-form` → `npm run build`.

  Confirmed:
  - The base is selected with `--base aria` and saved as part of the style name (`"style": "aria-nova"`).
  - The aria registry has 60 UI items. `Table` and `ComboBox` are real React Aria wrappers. There's no
    `DropZone`/`FileTrigger`/`GridList`/`ListBox`/`TextField` wrapper, and `form` is an empty stub.
  - Namespaced registries work via `components.json` `registries` with `{name}` (and `{style}`) URL templates.
  - Theming is Tailwind v4 CSS variables.

  Corrections, applied to PRD specs 8–11:
  - Blocks import the unwrapped React Aria pieces directly, styled only with theme tokens.
  - Blocks require an `aria-*` consumer style, since bare `registryDependencies` follow the consumer's style.
  - The smoke test needs `--preset` (init hangs on a prompt without it).
  - Upstream bug: shadcn's aria `label.tsx` fails `tsc` under the Vite template's `noUnusedLocals`
    (`TS6133: 'React' is declared but its value is never read`). Deleting the line made the build pass.

  Location decided: root `registry/`, Nx name `ui-registry`, tags `type:registry`/`scope:ui`.

  Side finding, not fixed here: the repo has no Nx tags at all, and the root `eslint.config.mjs` `depConstraints`
  is a wildcard, so the `CLAUDE.md` dependency matrix isn't actually enforced by
  `@nx/enforce-module-boundaries` today.

- [x] **2. Spike: QuickJS sandbox mechanics** _(PRD spec 4)_
      Prototype outside the repo (or on a throwaway branch). Confirm:
  - `quickjs-emscripten`'s asyncify API for awaiting a host-side `async` function from guest code, including
    `Promise.all` over several bridged calls
  - interrupt-handler deadline enforcement
  - memory and stack limits
  - per-execution cold-start cost, with and without reusing the compiled WASM module

  Decide on TypeScript input: JS-only, or host-side type stripping (Node 22 `module.stripTypeScriptTypes` vs a
  bundled stripper). Propose default `CodeLimits` values (timeout, memory, stack, max calls, max output bytes).
  **Accept:** findings, the TS-input decision, and the default limits recorded as Decisions rows in the PRD. A
  documented reason if any part of PRD spec 4 needs to change.
  **Done (2026-10-07):** recorded as PRD Decisions #12–13, and spec 4 amended. Measured on Node 22.17 (cross-checked
  on 22.14 and 24.3) with a scratch prototype executor and test suite; none of it is in the repo.

  Two PRD assumptions were wrong, and both are fixed:
  - **Asyncify is out.** It serializes bridged calls (161 ms vs 51 ms for a 3-way `Promise.all`), throws
    `Already suspended` when two executions share a module, and crashed the process. The replacement is the
    **sync** build (`quickjs-emscripten-core` + `@jitl/quickjs-wasmfile-release-sync`) with a promise bridge
    (`ctx.newPromise()` + `executePendingJobs()`). That runs bridged calls concurrently: 20 concurrent executions
    × 3 parallel calls in 72 ms.
  - **QuickJS's `setMemoryLimit` is soft.** An `Array(1e5).fill` bomb under an 8 MB limit grew memory to 2 GB
    (1.65 GB RSS). The hard cap is a bounded `WebAssembly.Memory` per execution, which failed cleanly in 79 ms at
    64 MB. So each execution now gets a **fresh WASM instance** from a once-compiled module, at 0.66 ms median.

  Other findings:
  - QuickJS shares Node's native stack, so `stackBytes` must stay under about ¼ of the host stack. The default is
    192 KB.
  - Leftover deferreds must be disposed before the context, or the module aborts.
  - Every escape probe (`process`/`require`/`fetch`/timers/`import("fs")`/`Function`-constructor) found nothing.

  TS input: stripped host-side via `module.stripTypeScriptTypes` after wrapping (Node ≥22.13, feature-detected).

  Default limits: 10 s, 32 MB soft / 64 MB hard, 192 KB stack, 50 calls, 64 KB output.

- [x] **3. `@mantlejs/mcp`: `mode` option + `McpCodeModeProvider` extension point** _(PRD spec 1)_
      Add `mode?: "tools" | "code" | "both"` and `codeMode?: McpCodeModeProvider` to `McpOptions`
      (`packages/mcp/src/lib/types.ts`). The provider receives the resolved expose map, `describe()` output, and the
      effective query options. It returns `McpToolDefinition[]`/`McpResourceDefinition[]`. Export the schema-building
      helpers from `tools.ts`/`query-schema.ts` for providers to reuse. The default is `"code"` with a provider and
      `"tools"` without one.
      **Accept:**
  - Every existing `@mantlejs/mcp` spec stays green, unmodified.
  - New specs cover:
    - each `mode`
    - default resolution
    - provider tool-name collision → `BadRequest`
    - `mode: "code"` with no provider → `BadRequest`
    - the provider receives the resolved map (never `"*"`)
  - README "Code mode" section added.
  - `npx nx run-many -t build,test,lint,typecheck` green.
    **Done (2026-10-08):**
  - **Options:** `McpOptions` gained `mode` (`McpMode`) and `codeMode?: McpCodeModeProvider`. The default is
    `"code"` with a provider and `"tools"` without one, so there's zero change for existing deployments.
  - **Provider:** `build({ app, services, query })` runs once, when the expose map is resolved (`listen()`/
    `startMcp()`).
    - `services` is `McpExposedService[]` (`path`, exposed `methods` including custom ones, `descriptor`), with
      `"*"` and `true` already expanded.
    - It returns `McpCodeModeSurface` (`tools`, optional `resources`).
  - **What `"code"` registers:** it suppresses only the generated per-method tools. App-authored
    tools/resources/prompts and event resources are registered in every mode.
  - **Shared schema helpers:** `describeServiceMethod`, `buildQuerySchema`, and `toolName` are exported.
    Generated tools are now built through `describeServiceMethod`, and a spec checks the two stay identical
    (PRD Decision #7).
  - **Validation:** tool and resource validation was extracted into shared helpers and is applied to provider
    output too. Existing error messages are unchanged.
  - **Boot errors** (`BadRequest`): an unknown `mode`, a provider without `build()`, and `"code"`/`"both"` without
    a provider.
  - **Implication for item 4:** session `params` don't carry `HookContext.agent`, which only exists inside the
    hook pipeline. So the provider's per-session agent narrowing must resolve the agent token from
    `params.headers.authorization` itself, via the auth engine. This is documented in `types.ts` and the README.
  - **Results:** 21 new specs in `code-mode.spec.ts`; the four existing spec files are unmodified. Full workspace
    `build,test,lint,typecheck` green on 43 projects after merging with item 3a.

- [x] **3a. Enforce the package dependency matrix** _(PRD spec 15)_
      Found by the item 1 spike: the workspace has no Nx tags, and the root `eslint.config.mjs` `depConstraints` is a
      single wildcard, so `CLAUDE.md`'s "enforced by `@nx/enforce-module-boundaries`" claim isn't true. Do this
      before items 4 and 8, so `mcp-code` and `registry` are created under real constraints.
  - Tag every project via `package.json` `nx.tags`: `pkg:<name>`, plus `type:lib`/`type:registry`/`type:app`/
    `type:tool`.
  - Extend `depConstraints` additively with one entry per matrix row. `type:app` → `*`; `mantle`/`cli` → nothing.
  - Scope dev-only exceptions (e.g. `@mantlejs/client` specs importing `@mantlejs/mantle`) to `**/*.spec.ts(x)`
    overrides, and list each one in the PRD's Decisions.
  - Fix any violations that surface. If the matrix itself is wrong, correct `CLAUDE.md` in the same change and
    record why.
  - Add a cross-check (spec or `tools/` script run in CI) that fails if `depConstraints` and `CLAUDE.md`'s matrix
    diverge.

  **Accept:**
  - Every project is tagged.
  - A deliberate forbidden import (e.g. `@mantlejs/auth` → `@mantlejs/knex`) fails `nx lint`, then is reverted.
  - The cross-check is green.
  - `npx nx run-many -t lint` green with real constraints.
    **Done (2026-10-08):**
  - **Tags:** every project is tagged in `package.json` `nx.tags`: `pkg:<name>` + `type:lib` for the 39 packages,
    and `type:app` for the 4 example apps. No `type:tool` tag was needed, since nothing under `tools/` is an Nx
    project.
  - **Constraints:** the root `eslint.config.mjs` builds one `depConstraints` entry per `CLAUDE.md` matrix row from
    an exported `dependencyMatrix`. The old match-everything wildcard is gone. A spec-file override adds the
    `testOnlyDependencies` exceptions. Existing rule options are kept.
  - **Violations:** switching the real constraints on surfaced 14, all in spec files and zero in production
    source. They're recorded as narrow test-only exceptions in config and in the `CLAUDE.md` matrix:
    `client`→`mantle` (already documented as dev-only), `mcp`→`http`/`memory`/`auth`, `audit`→`memory`/`knex`,
    `embeddings`→`memory`.
  - **Matrix fit:** every package's `@mantlejs/*` deps and peerDeps already fit its matrix row, so no allowed
    production dependency changed.
  - **Cross-check:** `tools/check-dependency-matrix.mjs` (`npm run check-dependency-matrix`, new CI step)
    cross-checks:
    - the `CLAUDE.md` table and its test-only notes
    - the configured lint rules
    - project tags
    - each package's `@mantlejs/*` deps/peerDeps (and devDeps against its row plus test-only extras)

    It caught all 6 deliberate drift mutations it was tested with.

  - **Proof it fires:**
    - An `@mantlejs/auth` → `@mantlejs/knex` import failed `nx lint auth` with
      `A project tagged with "pkg:auth" can only depend on libs tagged with "pkg:mantle"`, both in production source
      and in a spec.
    - An `audit` → `memory` import in production source also failed, proving test-only exceptions don't leak.
    - All probes were reverted.
  - **Results:** `nx run-many -t build,test,lint,typecheck` green on 43 projects after merging with item 3.
  - **Not fixed (pre-existing):** three example `package.json` files (`realtime-chat`, `todo-minimal`,
    `knowledge-base/api`) and a few `packages/mcp` files don't match prettier on `main`. They were left as-is.

---

## Stage 2 — Build

### Code mode track

- [x] **4. `@mantlejs/mcp-code`: scaffold + typed API generation** _(PRD spec 2)_
      Generate the package with the `nx-generate` skill (`@nx/js:library`, tsc, vitest, publishable,
      `@mantlejs/mcp-code`). Add it to `CLAUDE.md`'s monorepo tree and dependency matrix (`@mantlejs/mantle`,
      `@mantlejs/mcp`) and to the module-boundary config.

  Implement declaration generation:
  - entity, create, and patch types from schemas, with a `Record<string, unknown>` fallback when there's no schema
  - a capability-narrowed `where`
  - custom methods
  - doc comments with destructive-op and find-limit notes
  - agent-scope narrowing via `matchesCapabilityScope`
  - a header-plus-per-service block layout

  Decide and document the mapping for awkward path identifiers (`blog-posts`, nested paths).
  **Accept:**
  - Snapshot specs over a fixture app.
  - The generated output compiles with the TypeScript compiler API, with zero diagnostics.
  - Agent-narrowing spec.
  - Drift spec: code-mode parameter types and tool-mode input schemas come from the same helper.
    **Done (2026-10-08):**
  - **Scaffold:** `@mantlejs/mcp-code`, tagged `pkg:mcp-code`/`type:lib`, in `nx.json`'s `experimental` group.
    `CLAUDE.md` tree and matrix row plus the `dependencyMatrix` entry are added (test-only extras:
    `http`/`memory`/`auth`/`audit`).
  - **Declarations:** generated from `describeServiceMethod()`'s JSON Schemas via a small schema-to-TS converter.
    - Where-operators are narrowed to the adapter's capabilities.
    - Doc comments carry the destructive-op and find-limit notes.
    - Only the type aliases the visible methods actually use are emitted.
  - **Path mapping:** paths are used verbatim as keys (PRD Decision #15).
  - **Agent narrowing:** filters by the token's `CapabilityScope`, resolved through the duck-typed `app.get("auth")`
    engine. Display-only (PRD Decision #16).
  - **`@mantlejs/mcp` change:** it now also exports `createServiceMethodRunner`, and tool mode runs through it too,
    so code-mode calls share the exact find-clamp, query-translation, and id-check path.
  - **Specs (25):** snapshot, TS compiler API compile with zero diagnostics, correct and incorrect usage
    type-checked, narrowing, drift.

- [x] **5. `@mantlejs/mcp-code`: `quickJsExecutor` + `search_api`/`execute` tools** _(PRD specs 3, 4)_
  - Implement the `CodeExecutor` interface and `quickJsExecutor()`, following PRD Decisions #12–13:
    - sync build + promise bridge
    - module compiled once, a fresh bounded-memory instance per execution
    - deferreds disposed before the context
    - host-side faults mapped to a typed error
    - raw bridge function hidden; strict-mode wrapper
    - host-side TS stripping
  - Implement the bridge: `mantle.<path>.<method>` → `service.dispatch()` with the session's params,
    `params.mcp = { mode: "code", executionId }`, and JSON-only values, with find-limit clamping applied.
  - Enforce the limits with typed `MantleError` subclasses (never a plain `Error`).
  - Add the `search_api` and `execute` tools and the `mantle://code/api.d.ts` resource.
  - Export the executor conformance suite.

  **Accept:**
  - Conformance suite green against `quickJsExecutor`: bridge round-trip, sequential and parallel async calls,
    fresh context per execution.
  - `search_api` filter and index specs.
  - `execute` specs: happy path, log capture, caught `MantleError`, uncaught → tool-error shape, truncation note.
  - `mode: "code"` lists exactly two tools.
    **Done (2026-10-08):**
  - **Executor:** `quickJsExecutor()` follows PRD Decisions #12–13:
    - sync build + promise bridge
    - a fresh bounded `WebAssembly.Memory` per execution
    - pending deferreds disposed before the context
    - instances killed by a host fault are abandoned to the garbage collector rather than torn down, since tearing
      them down tripped QuickJS's leak assertion
    - strict mode, line numbers preserved
  - **Typed limit errors:** `CodeTimeout` (408), `CodeLimitExceeded` (422), `CodeOutputTooLarge` (413),
    `CodeScriptError` (422), `CodeExecutorFault` (500). See PRD Decision #18 for the error and output policy.
  - **Provider:** `codeMode({ executor?, limits?, auditScriptSource? })` provides `search_api`, `execute` (with
    host-side TS stripping), and the `mantle://code/api.d.ts` resource.
  - **Conformance:** `CODE_EXECUTOR_CONFORMANCE_CASES` (33 cases) and `conformanceBridge()` are exported. The 3-way
    `Promise.all` case passes its faster-than-serial timing check.
  - **Specs:** 37 executor + 19 provider specs green.

- [x] **6. Code mode: security, equivalence, agent scope, audit** _(PRD spec 5)_
  - **Escape specs:** `process`/`require`/`fetch`/host `globalThis`/`Function`-constructor reach nothing.
  - **Limit specs:** infinite loop, memory bomb, call cap, oversized output. Each fails with a typed error, and
    the host process survives.
  - **Equivalence:** extend the `hook-pipeline-equivalence.spec.ts` pattern to HTTP, tool mode, and code mode.
  - **Agent scope:** out-of-scope call → catchable `Forbidden` matching `authorizeAgent()`'s shape.
  - **Audit:** N calls produce N records sharing `executionId`.

  Decide the script-source audit policy (recommended: a hash by default, full source opt-in) and record it in the
  PRD's Decisions.
  **Accept:** all spec groups green. Any bug they surface gets fixed before moving on, not just documented (same
  rule as Phase 6 item 3).
  **Done (2026-10-08):**
  - **Equivalence:** HTTP, tool mode, and code mode give identical 401/403/200 decisions from the same hook chain,
    and the 403 is catchable inside a script.
  - **Agent scope:** an out-of-scope agent call gets a catchable `Forbidden` identical to `authorizeAgent()`'s and
    tool mode's. Narrowing is display-only (PRD Decision #16). A revoked token is shown the full API but still
    rejected on every call.
  - **Audit:** N calls produce N audit records sharing `executionId` and `scriptHash` (PRD Decision #17). This
    required adding an optional `AuditRecord.mcp` to `@mantlejs/audit`. Script source is recorded only when
    opted in.
  - **Unexposed services:** registered but unexposed services don't exist inside the sandbox.
  - **Escapes and limits:** covered by the conformance suite.
  - No bugs found in existing packages.

- [x] **7. Code mode: example + README** _(PRD spec 6)_
      Add a code-mode MCP entry point to `examples/knowledge-base/api` next to the existing MCP setup, plus a
      walkthrough script (multi-service filter + aggregate in one `execute`). Write the `@mantlejs/mcp-code` README:
  - quick start
  - `mode` table
  - script contract
  - limits/defaults
  - security model
  - custom executors + conformance suite
  - when to prefer tool mode

  **Accept:** the example boots and the walkthrough runs end to end. The README quick start is
  copy-paste-correct.
  **Done (2026-10-08):**
  - `examples/knowledge-base/api` serves code mode at `/mcp-code` next to the existing `/mcp`, with a bootstrap
    spec.
  - The example README has a walkthrough. The script is verified word for word by a spec against in-memory
    services with the same return shapes. It wasn't run against live Postgres, because Docker wasn't running at
    the time; a live run is still worth doing before release.
  - New `@mantlejs/mcp-code` README (quick start, mode table, script contract, limits, security model, custom
    executors + conformance suite, when to prefer tool mode). The `@mantlejs/mcp` README is updated.
  - Two follow-ups are recorded in the PRD's Release Plan: `search_api` string results get JSON-quoted, and a
    second `mcp()` overwrites `mcp:server` for stdio.
  - Full workspace `build,test,lint,typecheck` green on 44 projects (Node 22.17), and
    `check-dependency-matrix` green on 40 package rows. Test counts: `mcp-code` 90, `mcp` 67 (existing specs
    unmodified), `audit` 14, `knowledge-base-api` 32.

### UI registry track

- [x] **8. Registry project + build pipeline + install smoke test** _(PRD spec 8)_
      Create `registry/` at the repo root:
  - private workspace, Nx name `ui-registry`
  - itself an `aria-*` shadcn project (`components.json`, base primitives, `@/` alias)
  - tags `type:registry`/`scope:ui`, plus a `depConstraints` entry limiting it to `@mantlejs/client`/
    `@mantlejs/react` (which means tagging those two)
  - a `build-registry` target running `shadcn registry validate` then `shadcn build`

  Decide how the `aria-*`-style requirement is enforced or documented, and test what happens on a non-aria style.

  Add an install smoke test modeled on `packages/create-mantlejs/e2e/scaffold-smoke.mjs`:
  1. Run `shadcn init --template vite --base aria --preset <name> --no-monorepo --yes` with a pinned `shadcn`
     version.
  2. Point the `@mantle` registry at the locally served `public/r/{name}.json`.
  3. Run `shadcn add @mantle/<block>` for every block.
  4. Type-check and build.

  Run it on at least two presets. Work around the upstream aria `label.tsx` TS6133 error until it's fixed. Wire it
  into `.github/workflows/ci.yml` next to `e2e-scaffold`.
  **Accept:** `build-registry` emits valid JSON per block, and the smoke test is green locally and in CI on every
  tested preset.
  **Done (2026-10-08):**
  - **Project:** `registry/` is a private workspace project (Nx `ui-registry`, tags `pkg:ui-registry` +
    `type:registry`) and itself an aria-nova shadcn project, with vendored primitives under `src/components/ui`.
  - **Matrix:** the `dependencyMatrix` and `CLAUDE.md` rows allow `client` and `react` only.
    `tools/check-dependency-matrix.mjs` gained standalone-project support.
  - **Build:** `build-registry` runs `shadcn registry validate`, then `shadcn build`, then a per-style fan-out
    (`scripts/fan-out-styles.mjs`).
  - **Aria-only enforcement (PRD Decision #19):** a radix-nova consumer using `{name}` URLs got a "successful" add,
    then 13 TS errors and a silently unwired `Input`. With `{style}` URLs, the same consumer now gets a not-found
    error at install time.
  - **Smoke test:** `e2e-install` (`registry/e2e/install-smoke.mjs`) runs in CI after `e2e-scaffold`.
    - It installs every block into fresh aria-nova and aria-vega apps, using `npm pack` tarballs of the workspace
      `client`/`react`, then runs `tsc` and `vite build`.
    - It also asserts the radix refusal.
    - shadcn is pinned at 4.21.4.
    - Measured on the merged `main`: nova 30.1s, vega 17.2s, radix refusal 12.6s.
  - **`label.tsx`:** the TS6133 workaround is applied conditionally and logs once upstream fixes it (PRD
    Decision #21).

- [x] **9. Auth blocks** _(PRD spec 9)_
      `login-form`, `signup-form`, `oauth-buttons` (Google, GitHub, Facebook, Apple, Microsoft, LinkedIn, X), and
      `auth-provider` + `useAuth()`. Built on React Aria `Form`/`TextField`, imported directly (shadcn has no wrapper
      for them), combined with shadcn aria `input`/`label`/`field`/`button`, with field-level validation and typed
      error display.
      **Accept:** per block:
  - Vitest + Testing Library specs: happy path, typed errors, keyboard-only operation
  - axe checks with zero violations in each rendered state
  - included in the smoke test
    **Done (2026-10-08):**
  - **Blocks:** `auth-provider`/`useAuth` (over `@mantlejs/react`'s `useMantleClient`), `login-form`, `signup-form`
    (React Aria `Form`/`TextField`/`FieldError` imported directly, plus shadcn aria `input`/`label`/`button`/`alert`),
    and `oauth-buttons` (aria `LinkButton`).
  - **Errors:** a shared `lib/mantle-errors.ts` maps `Unprocessable` field errors onto React Aria
    `validationErrors`, and shows everything else as a form-level alert.
  - **OAuth:** text-only buttons covering the **7** OAuth strategies. The PRD said 8 but listed 7; it's corrected.
  - **Specs:** 22, each with happy path, typed errors, keyboard-only use, and axe (zero violations).

- [x] **10. Storage + data blocks** _(PRD spec 10)_
  - `upload-dropzone` (`DropZone` + `FileTrigger` → `@mantlejs/storage`)
  - `realtime-list` (`GridList` + live query)
  - `data-table` (`Table`, sort → `QueryParams.sort`)
  - `mantle-pagination` (`Paginated<T>`; renamed from `pagination`, see PRD Decision #21)
  - `search-combobox` (`ComboBox`, `$ilike` when advertised, otherwise `$like`)

  `DropZone`/`FileTrigger`/`GridList` come straight from `react-aria-components` (shadcn doesn't wrap them) and are
  styled with semantic theme tokens only.

  **Accept:**
  - Same spec and axe bar as item 9.
  - A realtime event updates the list without a refetch.
  - A sort interaction produces the expected `QueryParams.sort`.
  - All blocks included in the smoke test.
    **Done (2026-10-08):**
  - **`upload-dropzone`:** React Aria `DropZone`/`FileTrigger`, upload over XHR with progress, errors mapped via
    `errorFromResponse`. jsdom can't simulate drag-and-drop, so the picker and keyboard paths are specced, not the
    drop itself.
  - **`realtime-list`:** `GridList`. Service events are written into the query cache, so there's no refetch; a spec
    proves it.
  - **`data-table`:** shadcn aria `table`. A column sort maps to `QueryParams.sort`, and a spec proves it.
  - **`mantle-pagination`:** renamed per PRD Decision #21, with a `pageWindow` helper.
  - **`search-combobox`:** runtime `$ilike` → `$like` fallback (PRD Decision #20).
  - **Specs:** 39 plus 4 for `mantle-errors`, with zero axe violations.
  - **Client-SDK gaps the blocks work around** are recorded in the PRD's Release Plan. One is a real bug:
    `authenticate()` accepts a 200 response with no `accessToken`.

- [x] **11. Retrofit `examples/knowledge-base/web`** _(PRD spec 11)_
      Run `shadcn init --base aria` first (the example has no `components.json` or `@/` alias yet). Then replace
      `src/components/ui/{button,card,input,textarea}.tsx` (and their hard-coded `bg-slate-*` styling) and any hand-rolled auth/upload/list UI with
      registry installs. Document the `shadcn add` commands in the example's README.
      **Accept:** the example builds, the same flows work with no regressions, and no hand-rolled UI primitives remain.
      **Done (2026-10-08):**
  - **Setup:** `examples/knowledge-base/web` now runs on shadcn's React Aria base (`components.json`, `@/` alias)
    with five Mantle blocks installed from the registry.
  - **Removed:** the hand-rolled `components/ui/*`, the slate palette, and `lib/cn.ts`.
  - **Search results:** use React Aria `GridList` directly. They come from `similar()`, not `find()`, so no block
    fits.
  - **Unchanged:** the attachments list stays a plain list of download links.
  - **Visible change:** the OAuth buttons now stack vertically instead of sitting in a row.
  - **Registry source:** `components.json` points `@mantle` at a locally served registry
    (`http://localhost:4893/r/{style}/{name}.json`) until item 13 hosts it. The README explains how to serve it.
  - **Results:** same flows, 4 specs pass, build green. After rebasing onto `mcp-code`, the full workspace
    `build,test,lint,typecheck` is green on 45 projects (Node 22.17) and `check-dependency-matrix` is green on 41
    rows.

---

## Stage 3 — Website

- [ ] **12. Starlight scaffold + content pipeline** _(PRD spec 12)_
  - Scaffold `website/` as an unpublished Astro Starlight app, exempt from package boundaries like `examples/*`.
  - Write the guides: getting started, architecture, adapters + capability matrix, auth, agents (tool mode vs code
    mode, agent identity, audit), storage, realtime, deployment.
  - Pull in package READMEs at build time via a content loader.
  - Generate the API reference from the emitted `.d.ts` (pick and record the Starlight TypeDoc integration).
  - Generate `llms.txt`/`llms-full.txt`.
  - Record the doc-versioning policy in Decisions.

  **Accept:**
  - The site builds in CI.
  - The link check passes.
  - Every published package has a reference page.
  - `llms.txt` is generated.
  - A README edit shows up after a rebuild.

- [ ] **13. Registry hosting, live demos, deploy** _(PRD spec 13)_
  - Serve the registry at `/r/*.json`.
  - Add React-island demos for every block against a mocked client transport.
  - Decide the domain (`mantlejs.com` vs `mantlejs.org`) and the hosting target, and record both in the PRD's
    Decisions.
  - Add a CI deploy job (on release; decide whether docs-only changes on `main` deploy too).

  **Accept:**
  - The deployed site is reachable.
  - `npx shadcn add https://<domain>/r/login-form.json` works in a fresh app.
  - Every block page renders a working demo.

---

## Stage 4 — Release

- [ ] **14. Release + post-release verification** _(PRD Release Plan)_
      Release steps:
  1. Add `mcp-code` to `nx.json`'s `experimental` group.
  2. Run the tier-list review for `audit`/`embeddings` against the Phase 6 promotion bar (promote per package, or
     record why one stays experimental).
  3. Confirm `tools/bump-peer-ranges.mjs` handles `mcp-code`'s peer on `@mantlejs/mcp` (a peer range that crosses
     groups).
  4. Audit `examples/*` exact pins.
  5. Run `nx release version` (dry-run first) and publish.
  6. Deploy the site.
  7. Update `CLAUDE.md` (tree, dependency matrix) and the root README packages table.

  **Accept:**
  - All Phase 7 packages are live on npm at their tier's version.
  - The site is deployed and the registry is reachable.
  - Post-release verification at the depth of Phase 6 item 9: install each new or changed package from npm in a
    clean project and run its README quick start.
  - `npx nx run-many -t build,test,lint,typecheck` green.

---

## Reference

- [Phase 7 PRD](./mantle-js-phase-7-prd.md)
- [Phase 7 Backlog](./mantle-js-phase-7-backlog.md)
- [Phase 8 Backlog](./mantle-js-phase-8-backlog.md)
- [Phase 6 Checklist](./mantle-js-phase-6-checklist.md) — format and verification-depth precedent
- [`docs/releasing.md`](../releasing.md)
