# knowledge-base-web

The Vite + React + Tailwind frontend for [Mantle KB](../README.md), built on
`@mantlejs/client` + `@mantlejs/react`.

```bash
# From the workspace root (or anywhere inside it):
npx nx build knowledge-base-web
npx nx run knowledge-base-web:serve   # dev server, http://localhost:4200
```

Points at `VITE_API_URL` (default `http://localhost:3030`) — set it in the example's shared
`.env` if the API runs elsewhere. That file lives one level up, in `examples/knowledge-base/`
(copied from `.env.example` there, alongside `docker-compose.yml`), not in this package —
`vite.config.mts` sets `envDir: "../"` so Vite reads it from there instead of its own default
(this folder). Entry point: [`src/main.tsx`](./src/main.tsx); root component and auth-gated view
switching: [`src/app/app.tsx`](./src/app/app.tsx).
