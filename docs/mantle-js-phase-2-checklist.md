# Mantle JS — Phase 2 Implementation Checklist

Work through these in order. Each item maps to a package spec in the Phase 2 PRD and TDD.

---

- [x] **1. Add Logger interface to `@mantlejs/core`**
  Add the `Logger` interface to core's public API. Add `schema` field to `ServiceOptions` and `ServiceHandle`. No implementation — zero new dependencies. Wire all existing internal log points to `app.get('logger')?.debug/info/warn/error(msg, { component: 'mantle:*' })`.

- [x] **2. Implement `@mantlejs/logger`**
  New package. `pinoAdapter()` wrapper (flips pino argument order), `logger()` plugin factory, `logRequest()` hook, `logError()` hook. `LOG_LEVEL` env var controls verbosity. See Phase 2 TDD for log record shapes.

- [x] **3. Implement `@mantlejs/schema`**
  New package. Re-export TypeBox (`Type`, `Static`, `TSchema`). Implement `validate()` hook with field-level `Unprocessable` errors. Implement `resolver()` hook supporting single records and arrays; returning `undefined` from a field resolver removes that field.

- [x] **4. Implement `@mantlejs/memory`**
  New package. `MemoryRepository<T>` backed by a `Map`. Must support all `QueryParams` operators with the same semantics as `KnexRepository`. Include `seed()`, `clear()`, and readonly `store` test helpers. Auto UUID via `crypto.randomUUID()`, auto timestamps.

- [ ] **5. Implement `@mantlejs/config`**
  New package. `config()` plugin loads `config/default.json`, merges `config/{NODE_ENV}.json`, then applies `MANTLE_*` env var overrides (double underscore for nested keys). Optional TypeBox schema validates at startup — throws `GeneralError` on failure. Sets `app.set('config', merged)` and individual top-level keys.

- [ ] **6. Implement `@mantlejs/auth-google`**
  New package. `googleStrategy()` plugin. Registers `GET /auth/google` (redirect) and `GET /auth/google/callback` (code exchange, profile fetch, find-or-create user, issue Mantle JWT). Use PKCE. No Passport.js. Returns `{ accessToken, refreshToken, user }`.

- [ ] **7. Implement `@mantlejs/auth-github`**
  New package. `githubStrategy()` plugin. Registers `GET /auth/github` and `GET /auth/github/callback`. Fetches profile from `api.github.com/user` and emails from `api.github.com/user/emails` if needed. Find-or-create user, issue Mantle JWT. No Passport.js.

- [ ] **8. Implement `@mantlejs/socketio`**
  New package. `socketio()` plugin attaches a `socket.io` Server to the Express HTTP server. Wire socket events (`find`, `get`, `create`, `update`, `patch`, `remove`) through the full hook pipeline. Set `params.provider = 'socket.io'`. Emit `<service> created/updated/patched/removed` events to all connected clients after successful mutations. Must be configured after `express()`.

- [ ] **9. Implement `@mantlejs/upload-s3`**
  New package. `s3Storage()` returns a `StorageAdapter` for `@mantlejs/upload`. Use `@aws-sdk/lib-storage` `Upload` for multipart support. Support explicit credentials or AWS SDK default credential chain. `UploadedFile.path` is the full HTTPS S3 URL after upload.

- [ ] **10. Implement `@mantlejs/upload-gcs`**
  New package. `gcsStorage()` returns a `StorageAdapter` for `@mantlejs/upload`. Use `@google-cloud/storage`. Support Application Default Credentials or explicit `keyFilename`. `UploadedFile.path` is HTTPS URL when `public: true`, `gs://` URI when `public: false`.

- [ ] **11. Implement `@mantlejs/cli`**
  New package. `mantle` binary with `new <project-name>` (scaffold full project, prompts for transport / database / auth / package manager) and `generate <generator> <name>` (alias `g`). Generators: `service`, `hook`, `repository`. Generated service tests use `@mantlejs/memory`. No runtime imports from other Mantle packages.

---

## Reference

- [Phase 2 PRD](./mantle-js-phase-2-prd.md)
- [Phase 2 TDD](./mantle-js-phase2-tdd.md)
- [Phase 1 PRD](./mantle-js-phase-1-prd.md)
- [Phase 1 TDD](./mantle-js-phase1-tdd.md)
