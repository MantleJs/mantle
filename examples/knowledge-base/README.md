# Mantle KB — the canonical example

A team knowledge base with AI-powered semantic search — the flagship Mantle JS example.
Nearly every published package is wired into one real app: Express, Postgres/pgvector, Redis,
six OAuth strategies, realtime comments, file attachments, OpenAPI docs, and an MCP server so
AI agents can search and read articles through the exact same hook pipeline as the web UI.

Two Nx projects:

- **`api`** ([`knowledge-base-api`](./api)) — the Express backend
- **`web`** ([`knowledge-base-web`](./web)) — the Vite + React + Tailwind frontend

## Quick start

```bash
cp .env.example .env               # defaults work as-is — no secrets required
docker compose up -d               # Postgres (pgvector) + Redis
npx nx run knowledge-base-api:seed # sample users, articles, comments
npx nx run knowledge-base-api:serve   # http://localhost:3030
npx nx run knowledge-base-web:serve   # http://localhost:4200 (dev server)
```

Log in with a seeded account (`ada@example.com` / `s3cretpass`), or register a new one — local
auth is all that's required. OAuth strategies (Google, GitHub, Apple, Microsoft, LinkedIn) each
activate automatically once their client credentials are set in `.env`; nothing else changes.

## What's wired

| Capability | Where |
| --- | --- |
| API kernel, hooks, typed errors, batch | `@mantlejs/mantle` |
| HTTP transport + CORS | `@mantlejs/express` |
| Persistence (Postgres) | `@mantlejs/knex` |
| Semantic search over articles (pgvector) | `@mantlejs/knex`'s `KnexVectorRepository`, the `search` service |
| Auth: email+password + 5 OAuth providers | `@mantlejs/auth`, `auth-local`, `auth-oauth`, `auth-google`, `auth-github`, `auth-apple`, `auth-microsoft`, `auth-linkedin` |
| Refresh-token + OAuth state across instances | `@mantlejs/auth-redis` — activates when `REDIS_URL` is set |
| File attachments | `@mantlejs/storage` — disk by default, S3/GCS via `S3_BUCKET`/`GCS_BUCKET` |
| Validation | `@mantlejs/schema` — `users`/`articles`/`comments` create payloads |
| Realtime (article edits, comments) | `@mantlejs/socketio`, `@mantlejs/sync` (fans out across instances when `REDIS_URL` is set) |
| Structured logging | `@mantlejs/logger` — `createLogger({ gcp })` in the real entrypoint |
| Environment config | `@mantlejs/config` — `config/default.json`, `MANTLE_APP__PORT` override |
| API docs | `@mantlejs/openapi` — `/openapi.json`, Swagger UI at `/docs` |
| AI-agent access | `@mantlejs/mcp` at `/mcp` — deny-by-default: `articles`, `search`, `comments`, `activity` only, never `users` |
| Web frontend | `@mantlejs/client`, `@mantlejs/react` |
| Multi-repository service | the `articles` service — see [`api/src/services/articles-service.ts`](./api/src/services/articles-service.ts) |

The `articles` service is the multi-repository showcase from the root README's "Services with
multiple repositories" section: one hand-written `Service<Article>` composing an article
repository, an activity-log repository, and a vector repository over the same table — a plain
`RepositoryService` can only wrap one.

## Embeddings

`src/embedder.ts` defines a pluggable `Embedder` interface with a zero-key local default (a
deterministic hash-based bag-of-words vector — demo-quality by design, good enough to prove
semantic search end-to-end without an API key). Set `EMBEDDER_URL` to point at a real embedding
endpoint (`POST { text } -> { vector }`) instead. The web app's search box mirrors the same local
algorithm client-side (see [`web/src/lib/local-embed.ts`](./web/src/lib/local-embed.ts)) since
`/search/similar` takes a raw vector — that mirror only matches the *local* embedder; swapping in
`EMBEDDER_URL` server-side means the frontend needs the same swap (call the real embedding API,
or add a small `/embed` proxy route) to keep queries and stored vectors comparable.

## Verifying the MCP server

```bash
curl -s http://localhost:3030/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | jq
```

Lists `articles_find`, `articles_get`, `articles_create`, `articles_update`, `search_similar`,
`comments_find`, `comments_get`, `activity_find`, `activity_get` — never anything under `users_*`.

## Known scope cuts

- Attachment **download** isn't wired — `attachments` exposes metadata (`find`/`get`) and
  `create` (upload), but there's no streaming/signed-URL download route yet. The `StorageAdapter`
  interface already has `retrieve()`/`getSignedUrl()`; adding the route is a natural follow-up.
- The client-side search embedder only matches the server's *local* default (see above).
