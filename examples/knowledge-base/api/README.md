# knowledge-base-api

The Express backend for [Mantle KB](../README.md) — see the parent README for the full
capability table and quick start.

```bash
# From examples/knowledge-base (one level up from this package) — one-time setup:
cd examples/knowledge-base
cp .env.example .env      # seed/serve load this via the envFile option below; must exist
docker compose up -d      # Postgres (pgvector) + Redis — seed/serve need these reachable

# From the workspace root (or anywhere inside it):
npx nx build knowledge-base-api
npx nx run knowledge-base-api:seed    # sample data
npx nx run knowledge-base-api:serve   # http://localhost:3030
```

Entry point: [`src/index.ts`](./src/index.ts). App wiring (services, hooks, auth strategies):
[`src/app.ts`](./src/app.ts). Schema bootstrap (no separate migration tool):
[`src/migrate.ts`](./src/migrate.ts).
