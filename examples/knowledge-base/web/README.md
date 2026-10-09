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

## UI: shadcn (React Aria base) + the Mantle UI registry

This app is the first consumer of the [Mantle UI registry](../../../registry/README.md). Nothing under
`src/components/` is hand-rolled — it was all installed with the shadcn CLI, which is also how you'd add Mantle
blocks to your own app:

```bash
# 1. shadcn with the React Aria base (writes components.json + the theme in src/styles.css).
#    Needs the "@/*" → "./src/*" alias in tsconfig.json / tsconfig.app.json and vite.config.mts first.
npx shadcn init --base aria --preset nova

# 2. Register the @mantle namespace in components.json (already done here):
#    "registries": { "@mantle": "http://localhost:4893/r/{style}/{name}.json" }
#    — until the Mantle website hosts the registry, serve a local build from the repo root:
npx nx run ui-registry:build-registry && npx serve registry/public -l 4893

# 3. Add the blocks this app uses, plus the base primitives its pages compose directly.
npx shadcn add @mantle/login-form @mantle/signup-form @mantle/oauth-buttons \
  @mantle/upload-dropzone @mantle/realtime-list button card input textarea
```

Which block does what here:

| Where                                                        | Block(s)                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| [`app.tsx`](./src/app/app.tsx)                               | `auth-provider` — session restore, OAuth redirect handling, `useAuth()`              |
| [`AuthPage.tsx`](./src/pages/AuthPage.tsx)                   | `login-form`, `signup-form`, `oauth-buttons`                                         |
| [`ArticlesPage.tsx`](./src/pages/ArticlesPage.tsx)           | `realtime-list` (articles; new ones appear in place, no refetch)                     |
| [`ArticleDetailPage.tsx`](./src/pages/ArticleDetailPage.tsx) | `upload-dropzone` (attachments → `handleUpload("file")`), `realtime-list` (comments) |

`src/components/ui/label.tsx` carries one local edit: upstream's unused `import * as React` is removed, because it
fails this workspace's `noUnusedLocals` (TS6133) — the same workaround the registry's install smoke test applies.
