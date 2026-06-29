# Mantle JS — Phase 4 Implementation Checklist

Work through these in order. Each item maps to a package spec in the Phase 4 PRD.

---

- [ ] **1. Implement `@mantlejs/client`**
  New package. `mantle(options)` factory returns a `MantleClient`. Implements the full `Service<T>` method surface (`find`, `get`, `create`, `update`, `patch`, `remove`) as REST calls via native `fetch` (Node.js 18+, browser, React Native). `ClientParams.query` is serialized as URL query parameters. Real-time subscriptions (`ServiceClient.on('created', handler)`) use `socket.io-client` (optional peer dependency) when `socket` option is configured; throw `GeneralError` at call time if socket is not configured — socket connects lazily on the first `.on()` call. Handle authentication: `client.authenticate({ strategy, ...credentials })` calls `POST /authentication`, stores `accessToken` + `refreshToken` in the configured `TokenStorage` (default: `localStorage` in browser, in-memory in Node.js). Automatically attach `Authorization: Bearer <token>` to every REST request. On 401, attempt one token refresh via `POST /authentication/refresh` before retrying; on refresh failure emit `'logout'` and throw `NotAuthenticated`. Deserialize non-2xx responses into typed `MantleClientError` objects (`name`, `message`, `code`, `data`, `errors`). Export `mantle`, `MantleClient`, `ServiceClient`, `ClientOptions`, `TokenStorage`, `MantleClientError`.

- [ ] **2. Implement `@mantlejs/react`**
  New package. React hooks for Mantle services built on TanStack Query v5. Export `MantleProvider` (wraps `QueryClientProvider`, creates a default `QueryClient` if none provided, stores `MantleClient` in context), `useMantleClient`, `useFind`, `useGet`, `useCreate`, `useUpdate`, `usePatch`, `useRemove`. `useFind` and `useGet` wrap `useQuery` with keys `[service, 'find', params]` and `[service, 'get', id, params]`. Mutation hooks wrap `useMutation`. When the client has a socket configured, `useFind` and `useGet` register socket event listeners on mount (one set per `(client, service)` pair, reference-counted) that call `queryClient.invalidateQueries({ queryKey: [service] })` on `created`, `updated`, `patched`, and `removed` events. Opt-out per hook via `realtime: false` in options. Listeners are cleaned up when the last hook for a service unmounts. Export `MantleProviderProps`, `MantleQueryOptions`.

- [ ] **3. First npm release — all Mantle packages at `0.1.0`**
  Prepare and publish all packages (Phase 1–4) to the public npm registry. Steps:
  - Verify all packages build, test, and lint cleanly: `npx nx run-many -t build,test,lint`
  - Confirm every `package.json` has `"publishConfig": { "access": "public" }`, correct `"exports"`, `"main"`, `"module"`, `"types"`, and `"files": ["dist"]` fields
  - Set `version: "0.1.0"` consistently across all packages; align `peerDependencies` ranges
  - Verify all README files are complete (at minimum: installation, quick start, API reference)
  - Publish in dependency order: `@mantlejs/mantle` → adapters/transports → `@mantlejs/auth*` → `@mantlejs/upload*` → `@mantlejs/sync` → `@mantlejs/client` → `@mantlejs/react`
  - Confirm each package is resolvable: `npm install @mantlejs/<name>` succeeds from an empty project

---

## Reference

- [Phase 4 PRD](./mantle-js-phase-4-prd.md)
- [Phase 4 TDD](./mantle-js-phase4-tdd.md)
- [Phase 3 PRD](./mantle-js-phase-3-prd.md)
- [Phase 3 Checklist](./mantle-js-phase-3-checklist.md)
