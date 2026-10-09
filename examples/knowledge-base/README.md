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
repository with an activity-log repository — a plain `RepositoryService` can only wrap one. The
article's vector embedding is *not* one of `ArticlesService`'s own repositories: it's
`@mantlejs/embeddings`'s `embed()` hook, attached in [`src/app.ts`](./api/src/app.ts) to
`after.create`/`after.update`/`after.patch` on the `articles` service, upserting into the same
`ArticleVectorRepository` the `search` service reads from.

## Embeddings

`src/embedder.ts` defines a pluggable `Embedder` (a thin, dimensions-required alias of
`@mantlejs/embeddings`'s `EmbeddingProvider`) with a zero-key local default (a deterministic
hash-based bag-of-words vector — demo-quality by design, good enough to prove semantic search
end-to-end without an API key). Set `EMBEDDER_URL` to point at a real embedding endpoint
(`POST { text } -> { vector }`) instead. `app.ts` wires whichever one `createEmbedder()` returns
into `@mantlejs/embeddings`'s `embed({ vectors, provider, field })` — the hook that actually calls
it and upserts the result — rather than the service calling it directly: this is the cross-adapter
write-consistency pattern's reference implementation (idempotent upsert keyed on the article's id,
non-fatal on a provider or vector-store failure — see the root README). The web app's search box
mirrors the same local algorithm client-side (see
[`web/src/lib/local-embed.ts`](./web/src/lib/local-embed.ts)) since `/search/similar` takes a raw
vector — that mirror only matches the *local* embedder; swapping in `EMBEDDER_URL` server-side
means the frontend needs the same swap (call the real embedding API, or add a small `/embed` proxy
route) to keep queries and stored vectors comparable.

## Verifying the MCP server

```bash
curl -s http://localhost:3030/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | jq
```

Lists `articles_find`, `articles_get`, `articles_create`, `articles_update`, `search_similar`,
`comments_find`, `comments_get`, `activity_find`, `activity_get` — never anything under `users_*`.

## MCP code mode

The same services are also served read-only in **code mode** ([`@mantlejs/mcp-code`](../../packages/mcp-code/README.md))
at `/mcp-code`. Instead of nine tools, the agent sees two — `search_api` (the typed `mantle` API,
loaded piece by piece) and `execute` (run a script against it in a QuickJS sandbox) — and does a
multi-step task in one round trip. Every call inside a script runs the service's hooks exactly
like the tools at `/mcp` (e.g. `activity` still requires a logged-in user).

```bash
# The typed API, as an index …
curl -s http://localhost:3030/mcp-code -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_api","arguments":{}}}' \
  | jq -r '.result.content[0].text | fromjson'

# … and as TypeScript declarations for the services a task needs
curl -s http://localhost:3030/mcp-code -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_api","arguments":{"paths":["articles","comments"]}}}' \
  | jq -r '.result.content[0].text | fromjson'
```

A walkthrough task — *"the five most recently updated articles, with how many comments each
has"* — is several tool calls with intermediate results passing through the model in tool mode,
and one `execute` call in code mode:

```javascript
const articles = await mantle.articles.find({ sort: { updatedAt: "desc" }, limit: 5 });
const { data: comments } = await mantle.comments.find({
  where: { articleId: { $in: articles.map((a) => a.id) } },
  limit: 100,
  select: ["articleId"],
});
const counts = {};
for (const c of comments) counts[c.articleId] = (counts[c.articleId] ?? 0) + 1;
return articles.map((a) => ({ title: a.title, comments: counts[a.id] ?? 0 }));
```

```bash
SCRIPT='const articles = await mantle.articles.find({ sort: { updatedAt: "desc" }, limit: 5 }); const { data: comments } = await mantle.comments.find({ where: { articleId: { $in: articles.map((a) => a.id) } }, limit: 100, select: ["articleId"] }); const counts = {}; for (const c of comments) counts[c.articleId] = (counts[c.articleId] ?? 0) + 1; return articles.map((a) => ({ title: a.title, comments: counts[a.id] ?? 0 }));'
jq -n --arg code "$SCRIPT" '{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"execute",arguments:{code:$code}}}' \
  | curl -s http://localhost:3030/mcp-code -H 'content-type: application/json' -d @- \
  | jq -r '.result.content[0].text | fromjson'
```

returns `{ "result": [{ "title": "…", "comments": 2 }, …], "executionId": "…", "calls": 2, "logs": [] }`.
`articles.find` returns a plain array here (`ArticlesService` overrides `find`) while
`comments.find` is paginated — the declarations say `T[] | Paginated<T>`, so a general-purpose
script checks `Array.isArray`. The script above is covered verbatim by
`packages/mcp-code/src/lib/code-mode.spec.ts` against in-memory services of the same shapes.

## Known scope cuts

- The client-side search embedder only matches the server's *local* default (see above).
