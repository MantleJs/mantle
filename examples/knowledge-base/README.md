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
# 1. From this directory (examples/knowledge-base) — creates .env alongside docker-compose.yml.
#    Both the API (via the seed/serve targets' envFile option) and the web dev server (via Vite's
#    envDir) read this single file; defaults work as-is, no secrets required.
cd examples/knowledge-base
cp .env.example .env
docker compose up -d               # Postgres (pgvector) + Redis — also run from this directory

# 2. From the workspace root (or anywhere inside it — Nx resolves projects by name).
cd ../..                                # back to the repo root, if you cd'd above
npx nx run knowledge-base-api:seed      # sample users, articles, comments
npx nx run knowledge-base-api:serve     # http://localhost:3030
npx nx run knowledge-base-web:serve     # http://localhost:4200 (dev server)
```

Log in with a seeded account (`ada@example.com` / `s3cretpass`), or register a new one — local
auth is all that's required. OAuth strategies (Google, GitHub, Apple, Microsoft, LinkedIn) each
activate automatically once their client credentials are set in `.env`; nothing else changes.
A successful (or failed) OAuth login redirects the browser back to `WEB_URL` (default
`http://localhost:4200`) with the session — or an error — in the URL fragment, which
`web/src/pages/AuthPage.tsx` picks up on load.

`.env` is a required prerequisite once created — `knowledge-base-api:seed`/`:serve` load it via
the `envFile` executor option (see `api/package.json`), so a missing `.env` fails those commands
outright rather than silently falling back. Always run step 1 before step 2.

## Setting up an OAuth provider

Each strategy package's README has the full console walkthrough for getting a client ID/secret
and registering a redirect URI. With the API running on the default `localhost:3030`, register
exactly this callback URL on the provider's side (the API's own domain, not `WEB_URL` — the
provider redirects to the API, which then redirects on to the web app):

| Provider | Setup steps | Local callback URL to register | Env vars |
| --- | --- | --- | --- |
| Google | [`auth-google` README](../../packages/auth-google/README.md#google-cloud-console-setup) | `http://localhost:3030/auth/google/callback` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| GitHub | [`auth-github` README](../../packages/auth-github/README.md#github-oauth-app-setup) | `http://localhost:3030/auth/github/callback` | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| Microsoft | [`auth-microsoft` README](../../packages/auth-microsoft/README.md#microsoft-entra-admin-center-setup) | `http://localhost:3030/auth/microsoft/callback` | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT` (optional) |
| LinkedIn | [`auth-linkedin` README](../../packages/auth-linkedin/README.md#linkedin-developer-app-setup) | `http://localhost:3030/auth/linkedin/callback` | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` |
| Apple | [`auth-apple` README](../../packages/auth-apple/README.md#apple-developer-setup) | — see caveat below | `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` |

**Apple is the exception**: Sign in with Apple requires an HTTPS Return URL — plain
`http://localhost` is rejected outright. To exercise it locally, tunnel the API (e.g. `ngrok
http 3030`) and use the tunnel's HTTPS URL as both `WEB_URL` and the registered Return URL,
or skip Apple locally and only verify it against a deployed HTTPS domain.

Once credentials for a provider are in `.env`, restart `knowledge-base-api:serve` — they're read
at boot, so an already-running server won't pick up a `.env` edit.

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

- The client-side search embedder only matches the server's *local* default (see above).
