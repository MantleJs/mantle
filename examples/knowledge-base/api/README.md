# knowledge-base-api

The Express backend for [Mantle KB](../README.md) — see the parent README for the full
capability table and quick start.

```bash
npx nx build knowledge-base-api
npx nx run knowledge-base-api:seed    # sample data (requires the database to be up)
npx nx run knowledge-base-api:serve   # http://localhost:3030
```

Entry point: [`src/index.ts`](./src/index.ts). App wiring (services, hooks, auth strategies):
[`src/app.ts`](./src/app.ts). Schema bootstrap (no separate migration tool):
[`src/migrate.ts`](./src/migrate.ts).
