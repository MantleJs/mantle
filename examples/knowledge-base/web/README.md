# knowledge-base-web

The Vite + React + Tailwind frontend for [Mantle KB](../README.md), built on
`@mantlejs/client` + `@mantlejs/react`.

```bash
npx nx build knowledge-base-web
npx nx run knowledge-base-web:serve   # dev server, http://localhost:4200
```

Points at `VITE_API_URL` (default `http://localhost:3030`) — set it in `.env` (see the parent
directory's `.env.example`) if the API runs elsewhere. Entry point:
[`src/main.tsx`](./src/main.tsx); root component and auth-gated view switching:
[`src/app/app.tsx`](./src/app/app.tsx).
