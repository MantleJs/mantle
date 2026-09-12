# Mantle JS — Phase 5 Implementation Checklist

Work through these in order. Each item maps to a spec in the [Phase 5 PRD](./mantle-js-phase-5-prd.md) and a
design section in the [Phase 5 TDD](./mantle-js-phase5-tdd.md). Phase 5 is the **release phase** — stages run
strictly in order: develop packages (items 1–8) → release plan (item 9) → examples (items 10–11) → release
(item 12).

> **Restructure note (2026-07-18):** the previous version of this checklist held three review-derived items.
> `@mantlejs/mcp` stays (item 1); `KnexTimeSeriesRepository` and `@mantlejs/arangodb` moved to the
> [Phase 6 backlog](./mantle-js-phase-6-backlog.md), which also holds the website, the UI library, and the
> Phase 4 non-goal deferrals. The first npm release moved **in** from Phase 4 item 8 (item 12 below).
> **Update (2026-07-19):** `@mantlejs/auth-linkedin` added (item 5); `@mantlejs/mcp` promoted from the
> experimental tier to a **stable `0.1.0` release requirement** (PRD decision #11).

---

## Stage 1 — Packages

- [x] **1. Implement `@mantlejs/mcp` — expose Mantle services as MCP tools** *(TDD §1)*
  New package: `@mantlejs/mantle` + `@modelcontextprotocol/sdk`. `mcp(options)` builds an MCP server from
  registered services via `ServiceHandle.describe()` — one tool per **exposed** method (`users_find`, …),
  input schemas from the attached TypeBox schema plus a `QueryParams` schema constrained to
  `describe().capabilities.operators`; every call routes through the service dispatch path with
  `provider: "mcp"` (full hook pipeline, no bypass). **Deny-by-default expose map**: `services` is required,
  maps path → methods (`true` = all registered; `"*"` escape hatch); unknown path/method →
  configure-time `BadRequest`. `query.defaultLimit`/`maxLimit` clamp find results (defaults 25/100),
  advertised in the generated schema, truncation noted in results. App-authored composite `tools` run with
  session params (no privileged path); **no batch tool**. `transport: "stdio" | "http"` (HTTP via the
  `http:router` contract, bearer token → `params.user`). Errors return `MantleError.toJSON()` (incl. `hint`)
  as MCP tool errors. Optional `events: true` exposes event resources for expose-map services only.
  App-authored `resources` (read-only reference content) and `prompts` (client-surfaced templates) round
  out the MCP surface — both run with session params, both validated at configure time.
  **This package is a release requirement and ships stable `0.1.0`** (PRD decision #11) — acceptance
  coverage below is the compensating control for skipping the experimental tier.
  **Accept:** two-service app lists expected tools with correct schemas; expose-map spec (per-method
  filtering, deny-by-default, unknown path/method → `BadRequest`); unsupported operator → tool error naming
  it; hook `Forbidden` → tool error (pipeline proven); bearer-token auth spec; limit-clamp spec; custom-tool
  spec (chained dispatch through hooks, name collision → `BadRequest`); custom-resource specs (session
  params, reserved/duplicate URI → `BadRequest`); prompt specs (string + messages forms, capability gating).

- [x] **2. Add POST-callback support to `@mantlejs/auth-oauth`** *(TDD §2)*
  Additive `OAuthProvider.callbackMethod?: "GET" | "POST"` (default `"GET"`) + `CallbackExtras` argument to
  `fetchProfile`. `createOAuthPlugin` registers `router.post(callbackPath)` for POST providers, reading
  `code`/`state`/`error` from the parsed form body; GET providers untouched. Verify `@mantlejs/http` parses
  `application/x-www-form-urlencoded`; add if missing.
  **Accept:** POST happy path + missing-state specs; `extras.body` reaches `fetchProfile`; all existing
  GET-provider specs green without modification.

- [x] **3. Implement `@mantlejs/auth-apple`** *(TDD §3)*
  New package over `@mantlejs/auth-oauth` + Arctic. `AppleStrategyConfig` = `OAuthPluginConfig` minus
  `clientSecret`, plus `teamId`/`keyId`/`privateKey` (ES256 client-secret JWT signed per exchange by Arctic).
  `callbackMethod: "POST"` with `response_mode=form_post`; `exchangeCode` returns the id_token;
  `fetchProfile` decodes it (`sub`/`email`) and reads Apple's first-login `user` body field for the name;
  `entityIdField` default `"appleId"`. Update `CLAUDE.md` dependency matrix + root README.
  **Accept:** auth-URL spec (form_post + scopes); id_token profile specs (with/without email; first-login
  name; malformed `user` ignored); missing `sub` → `GeneralError`; exchange failure → `GeneralError`.

- [x] **4. Implement `@mantlejs/auth-microsoft`** *(TDD §4)*
  New package over `@mantlejs/auth-oauth` + Arctic `MicrosoftEntraId`. PKCE on; `tenant` option (default
  `"common"`); profile from `graph.microsoft.com/oidc/userinfo`; `entityIdField` default `"microsoftId"`.
  Update `CLAUDE.md` dependency matrix + root README.
  **Accept:** specs mirroring `google-strategy.spec.ts` + tenant default/override specs.

- [x] **5. Implement `@mantlejs/auth-linkedin`** *(TDD §5)*
  New package over `@mantlejs/auth-oauth` + Arctic `LinkedIn`. LinkedIn's OpenID Connect flow ("Sign In with
  LinkedIn using OpenID Connect" product — not the legacy v2 profile API); no PKCE (state round-trip CSRF
  protection, same posture as GitHub/Facebook); scopes `openid profile email`; profile from
  `api.linkedin.com/v2/userinfo`; standard GET callback; `entityIdField` default `"linkedinId"`; config is
  plain `OAuthPluginConfig`. Update `CLAUDE.md` dependency matrix + root README.
  **Accept:** specs mirroring `google-strategy.spec.ts` (no-PKCE URL construction; exchange failure;
  userinfo normalization with/without email; missing `sub` → `GeneralError`).

- [x] **6. Production-ready logging in `@mantlejs/logger`** *(TDD §6)*
  Additive `Logger.child?()` in core; `createLogger(options)` factory (pino as optional dependency; `level`
  env-aware, `redact` defaulting to exported `SENSITIVE_PATHS`, `pretty`, `gcp` severity mapping);
  `logRequest`/`logError` redaction (`redactParams`, redacted `error.data`); `loglayerAdapter` over a
  duck-typed `LogLayerLike` (no loglayer dependency — PRD decision #1); README deployment guidance
  (Cloud Run, levels via `@mantlejs/config`, process-level handlers, LogLayer usage).
  **Accept:** level/redaction/gcp/child/`loglayerAdapter` specs; `includeParams: true` emits `[Redacted]`
  for sensitive paths; missing-pino install-hint spec; existing hook specs unchanged.

- [x] **7. Verify + document multi-repository services** *(TDD §7)*
  Spec-only in `@mantlejs/mantle`: custom service composing two `MemoryRepository`s through the full
  `app.use` pipeline (hooks + events), including non-atomicity assertion. Docs section "Services with
  multiple repositories" (pattern, cross-adapter composition, `withTransaction` boundaries — same-instance
  Knex shares a transaction, cross-adapter does not); cross-reference from `RepositoryService` docs.
  **Accept:** composition spec green; docs landed; canonical example's `articles` service (item 10) uses the
  pattern in real code.

- [x] **8. CLI + `create-mantlejs` template refresh and smoke test** *(TDD §8)*
  Templates offer the current surface (mongodb database choice, `cors`, all seven auth strategies — local,
  google, github, facebook, apple, microsoft, linkedin — plus the redis stores, versions from a single
  `versions.ts` map). CI `e2e-scaffold` target: non-interactive `create-mantlejs` → install (workspace-linked /
  Verdaccio) → build + test → boot → CRUD round-trip → clean SIGTERM exit. Bug fixes only — no new CLI
  features.
  **Accept:** CI smoke job green against workspace packages.
  **Update (2026-09-10):** added `.github/workflows/ci.yml` (push/PR — build/test/lint/typecheck +
  this `e2e-scaffold` target; the prior workflow was manual-publish-only, so nothing ran this in CI
  before). Along the way, found a real npm bug: npm 11.2–11.4's Arborist crashes
  (`Cannot read properties of null (reading 'edgesOut')`) resolving vitest's peer-dependency graph —
  reproduced with a bare `vitest@^4.1.0` devDependency outside this repo entirely, confirmed fixed in
  npm 11.19.1. `ci.yml` pins `npm install -g npm@11.19.1` before installing. Not a Mantle code bug,
  but a real risk for anyone scaffolding a new app with an affected npm on their PATH — worth keeping
  in mind for `create-mantlejs`'s docs if it comes up again post-release. Local verification of this
  specific target was initially blocked by an unrelated, machine-local issue (a stray npm install
  directly under this developer's home directory shadowed npm resolution for anything run under it,
  independent of nvm's global version) — confirmed it doesn't apply to fresh CI runners, and flagged
  to the user rather than touched, since it was outside the repo. **Resolved (2026-09-10):** the user
  removed the stray `~/node_modules`; re-ran `npx nx run create-mantlejs:e2e-scaffold` and it passed
  end-to-end under npm 11.19.1 — scaffold → `mantle generate service` → workspace-linked `npm install`
  → `npm run build` → `npm test` → boot on an ephemeral port → `POST`/`GET /items` round-trip → `SIGTERM`
  → clean exit. This is the same target `ci.yml` now runs on every push/PR, so this was the last
  unverified piece of the Stage 4 pre-flight audit; item 8 (and the checklist as a whole through
  Stage 3) is confirmed green.

## Stage 2 — Release plan

- [x] **9. Finalize the release plan** *(PRD [Release Plan](./mantle-js-phase-5-prd.md#release-plan); TDD §10)*
  - `npx nx run-many -t build,test,lint,typecheck` fully green (examples included once they exist)
  - `tools/check-publish-fields` script + CI target: `publishConfig.access: "public"`, `files: ["dist"]`,
    `exports`/`main`/`module`/`types` into `dist`, license/repository fields, aligned peer ranges
  - README audit: every published package has installation, quick start, API reference
  - **Finalize the publish-tier list** — dedicated review of the PRD's working split against actual
    coverage; not a rubber stamp. Confirmed (2026-08-26, PRD [Decisions](./mantle-js-phase-5-prd.md#architectural--design-decisions)
    #11–12): stable `0.1.0` incl. `auth-apple`/`auth-microsoft`/`auth-linkedin`, `mcp`, **and `openapi`**
    (promoted off the working split — 100%/93.5% stmt/branch coverage, zero defects found) vs
    `0.1.0-experimental`: `dynamodb`, `pinecone`, `qdrant`, `neo4j`, `mongodb` (real defects found and fixed
    in three of the five during the review — see the PRD decision log for detail). `mcp` staying stable is
    conditional on item 1's full acceptance coverage having landed — confirmed done
  - Configure `nx release` (two lockstep groups: `stable` @ `0.1.0` tag `latest`; `experimental` @
    `0.1.0-experimental` tag `experimental`); Verdaccio rehearsal target. Done (2026-08-26): `nx.json`
    `release.groups.stable`/`.experimental` (31 + 5 projects, `projectsRelationship: "fixed"`,
    `currentVersionResolver: "disk"`, `updateDependents: "never"` — needed after a dry-run proved the
    default cascades a dependency's OWN version across group boundaries, which would have silently
    versioned `dynamodb`/`pinecone`/`qdrant`/`neo4j`/`mongodb` to `0.1.0` instead of
    `0.1.0-experimental` the first time `mantle` released). Verified via
    `nx release version <specifier> --groups=<name> --dry-run` and
    `nx release publish --groups=<name> --tag=<latest|experimental> --dry-run` for both groups — correct
    project counts, no cross-group leakage, dist-tags applied. Verdaccio target already existed at
    `@mantle/source:local-registry`. Surfaced and fixed along the way: every internal `@mantlejs/*`
    `peerDependency` was pinned to `^0.0.1`, which doesn't cover the incoming `0.1.0` — Nx's
    `preserveMatchingDependencyRanges` guard caught this and blocked the dry-run until ranges were bumped
    to `^0.1.0` workspace-wide
  - npm `@mantlejs` org: access confirmed, 2FA, granular automation token in CI, provenance enabled.
    Done (2026-08-27): org ownership and `auth-and-writes` 2FA confirmed via `npm org ls mantlejs` /
    `npm profile get`; a Granular Access Token (read-write, scoped to `@mantlejs`) is stored as the
    `NPM_TOKEN` GitHub secret; `.github/workflows/release-publish.yml` (manual `workflow_dispatch`
    only) publishes both groups with `NPM_CONFIG_PROVENANCE: true` + `id-token: write`. Full runbook,
    including token rotation, at [`docs/releasing.md`](../releasing.md). Outstanding: the initial
    token was minted with a short (7-day) expiry for early testing — mint a longer-lived one before
    the real publish in item 12

## Stage 3 — Examples

- [x] **10. Build the canonical example — `examples/knowledge-base`** *(PRD [Canonical Example](./mantle-js-phase-5-prd.md#canonical-example); TDD §9)*
  Team knowledge base with AI-powered semantic search: `knowledge-base-api` (Express, knex/pgvector, redis)
  and `knowledge-base-web` (Vite + React + shadcn/ui over `@mantlejs/client`/`@mantlejs/react`). Services:
  `users` (local + google/github/apple/microsoft/linkedin, auth-redis), `articles` (multi-repo showcase:
  article + activity-log + vector repositories), `comments` (realtime via socketio + sync), `attachments`
  (storage; disk dev, S3/GCS via env), `search` (vector similarity), `activity`. Wired: schema validation,
  openapi + Swagger UI, `mcp({ transport: "http" })`, `createLogger`, config, batch + CORS from the client,
  docker-compose (pgvector + redis), seed script, README walkthrough. Pluggable `Embedder` with a
  zero-key local default.
  **Accept:** `docker compose up` + serve runs the full app; every capability row in the PRD table is
  demonstrably exercised; MCP tool call from an agent hits the hook pipeline; CI builds/lints/tests it.
  Done (2026-08-30): all 6 services wired and exercised against a live ephemeral server in
  `api/src/app.spec.ts` (OAuth-gate-by-env, 401 without auth, OpenAPI doc lists `articles`, Swagger UI at
  `/docs`, MCP `tools/list` returns `articles_find`/`search_similar`/etc. and confirms `users_*` is absent —
  proving the deny-by-default expose map). `articles-service.spec.ts` proves the multi-repo write (article +
  activity-log + embedding) and non-atomicity contract with fake repositories. Along the way, found and fixed
  a real bug in the already-shipped stable `@mantlejs/auth`: `sanitizeUser()` unconditionally stripped
  `password`, which broke `auth-local`'s own internal credential lookup on the same service — fixed to gate
  on `params.provider` (same "no provider = internal/trusted" convention `authenticate()` already uses),
  regression test added. `npx nx run-many -t build,test,lint,typecheck` green across all 40 projects.
  **Update (2026-09-10):** Docker is now available; ran the full quick start end-to-end —
  `docker compose up -d` (pgvector + redis), `knowledge-base-api:seed`, `knowledge-base-api:serve`, and
  `knowledge-base-web:build`, all green. Live smoke: local-auth login, authed `articles` find, `users`
  401-without-auth, OpenAPI doc lists `articles`, MCP `tools/list` matches the expected set. Attachment
  download route (added since, item unrelated to this checklist entry — see `6df653d`) verified live:
  upload → download round-trips byte-for-byte with correct headers, missing id → 404; README's stale
  "known scope cut" note for it removed. Along the way, `npx nx run-many -t build,test,lint,typecheck`
  surfaced one real regression — `auth-oauth`'s spec-helper config type hadn't been widened for the
  `redirectUrl` option added in `1730782`, failing typecheck — fixed
  (`packages/auth-oauth/src/lib/create-oauth-plugin.spec.ts`); full re-run is green across all 40 projects.
  **Note:** attachment upload/download in this example have only ever been verified manually (curl), not
  via `app.spec.ts` — consistent with how this area was tested from the start, not a new gap.

- [x] **11. Build starter examples** *(TDD §9)*
  `examples/todo-minimal` (`@mantlejs/http` + `@mantlejs/memory`, single file, < 100 lines) and
  `examples/realtime-chat` (Express + socketio + knex/sqlite + auth-local + `@mantlejs/client` static page).
  **Accept:** both boot and pass a scripted smoke flow in CI; todo-minimal doubles as the README quick start.
  Done (2026-08-30): `todo-minimal` is 30 lines, passes a vitest CRUD round-trip against `@mantlejs/http`'s
  `fetchHandler` (no port binding needed), and a manual `curl` boot check. `realtime-chat` passes a vitest
  spec that registers a user, authenticates, and asserts a posted message arrives over a live
  `socket.io-client` connection, plus a 401-without-auth case; manually verified end-to-end via `curl`
  including that the login response no longer leaks the password hash (same `sanitizeUser()`-adjacent gap
  as item 10, fixed locally in this app before the framework-level fix was even in scope — see item 10's
  note). Both examples' `nx build`/`test`/`lint`/`typecheck` are green.

## Stage 4 — Release

- [ ] **12. First npm release — curated package set** *(moved from Phase 4 item 8; TDD §10)*
  - Verdaccio rehearsal: `nx release publish` to the local registry; rerun the CLI smoke test (item 8) and
    `todo-minimal` against it
  - Publish for real via `nx release` (dependency-ordered; stable tier then experimental dist-tag)
  - Post-release verification: `npm install @mantlejs/<name>` from an empty project for every package;
    `npm create mantlejs my-app` against the live registry produces a working app; re-point one example at
    registry versions and boot it
  - Tag `v0.1.0`, publish GitHub release notes (`nx release changelog`)
  **Accept:** all published packages resolvable and importable; live-registry scaffold works; tag + notes out.

---

## Reference

- [Phase 5 PRD](./mantle-js-phase-5-prd.md)
- [Phase 5 TDD](./mantle-js-phase5-tdd.md)
- [Phase 6 Backlog](./mantle-js-phase-6-backlog.md) — items moved out of this checklist
- [Phase 4 Checklist](./mantle-js-phase-4-checklist.md) — source of item 12
- [AI-First Architecture Review](./ai-first-architecture-review.md) — §6.3 (`@mantlejs/mcp` rationale)
