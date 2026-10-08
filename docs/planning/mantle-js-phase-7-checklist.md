# Mantle JS — Phase 7 Implementation Checklist

Work through these in order. Each item maps to a spec in the [Phase 7 PRD](./mantle-js-phase-7-prd.md). Phase 7
runs in four stages, in order:

1. Verify & foundations (items 1–3)
2. Build: code mode (items 4–7) and the UI registry (items 8–11). These two tracks are independent and can run in
   parallel.
3. Website (items 12–13)
4. Release (item 14)

> **Note (2026-10-06):** scope is MCP code mode (new), the Mantle UI library as a React Aria-based shadcn
> registry (backlog item 4), and the Mantle website (backlog item 3). Backlog items 1, 2, and 5 move to the
> [Phase 8 backlog](./mantle-js-phase-8-backlog.md). See the PRD's Decisions table, #1.

---

## Stage 1 — Verify & foundations

- [ ] **1. Spike: shadcn React Aria base + registry mechanics** _(PRD spec 7)_
      Before building any blocks, confirm against current shadcn docs and CLI:
  - how the React Aria base is selected (init flag / `components.json` field / style name)
  - which base primitives it provides as `registryDependencies`
  - the current `registry.json`/`registry-item.json` schema and `shadcn build` output
  - how a consumer declares a namespaced registry (`@mantle/…`)
  - Tailwind v4 theming expectations

  Decide the registry project's location (`registry/` vs `packages/ui-registry`) and its Nx tags.
  **Accept:** findings recorded as a new row in the PRD's Decisions table. Any PRD assumption they contradict is
  amended in the PRD before item 8 starts.

- [ ] **2. Spike: QuickJS sandbox mechanics** _(PRD spec 4)_
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

- [ ] **3. `@mantlejs/mcp`: `mode` option + `McpCodeModeProvider` extension point** _(PRD spec 1)_
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

---

## Stage 2 — Build

### Code mode track

- [ ] **4. `@mantlejs/mcp-code`: scaffold + typed API generation** _(PRD spec 2)_
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

- [ ] **5. `@mantlejs/mcp-code`: `quickJsExecutor` + `search_api`/`execute` tools** _(PRD specs 3, 4)_
  - Implement the `CodeExecutor` interface and `quickJsExecutor()`.
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

- [ ] **6. Code mode: security, equivalence, agent scope, audit** _(PRD spec 5)_
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

- [ ] **7. Code mode: example + README** _(PRD spec 6)_
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

### UI registry track

- [ ] **8. Registry project + build pipeline + install smoke test** _(PRD spec 8)_
      Create the unpublished registry project in the location chosen in item 1. Add Nx tags/boundaries (may depend on
      `@mantlejs/client`/`@mantlejs/react` only). Add a `build-registry` target that runs `shadcn build`.

  Add an install smoke test modeled on `packages/create-mantlejs/e2e/scaffold-smoke.mjs`:
  1. Create a fresh Vite + React + Tailwind v4 app.
  2. `shadcn init` with the React Aria base.
  3. `shadcn add` every block from the locally served registry.
  4. Type-check and build.

  Wire it into `.github/workflows/ci.yml` next to `e2e-scaffold`.
  **Accept:** `build-registry` emits valid JSON per block, and the smoke test is green locally and in CI.

- [ ] **9. Auth blocks** _(PRD spec 9)_
      `login-form`, `signup-form`, `oauth-buttons` (Google, GitHub, Facebook, Apple, Microsoft, LinkedIn, X), and
      `auth-provider` + `useAuth()`. Built on React Aria `Form`/`TextField`/`Button` with field-level validation and
      typed error display.
      **Accept:** per block:
  - Vitest + Testing Library specs: happy path, typed errors, keyboard-only operation
  - axe checks with zero violations in each rendered state
  - included in the smoke test

- [ ] **10. Storage + data blocks** _(PRD spec 10)_
  - `upload-dropzone` (`DropZone` + `FileTrigger` → `@mantlejs/storage`)
  - `realtime-list` (`GridList` + live query)
  - `data-table` (`Table`, sort → `QueryParams.sort`)
  - `pagination` (`Paginated<T>`)
  - `search-combobox` (`ComboBox`, `$ilike` when advertised, otherwise `$like`)

  **Accept:**
  - Same spec and axe bar as item 9.
  - A realtime event updates the list without a refetch.
  - A sort interaction produces the expected `QueryParams.sort`.
  - All blocks included in the smoke test.

- [ ] **11. Retrofit `examples/knowledge-base/web`** _(PRD spec 11)_
      Replace `src/components/ui/{button,card,input,textarea}.tsx` and any hand-rolled auth/upload/list UI with
      registry installs. Document the `shadcn add` commands in the example's README.
      **Accept:** the example builds, the same flows work with no regressions, and no hand-rolled UI primitives remain.

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
