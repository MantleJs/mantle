# realtime-chat

Express + Socket.IO + Knex/SQLite + `@mantlejs/auth-local`, with a bare static HTML page as the
client — no framework, `@mantlejs/client` loaded from a bundled `<script>` tag. The real-time
quick start: register, log in, and see messages posted by any tab appear live via
`.on("created")`.

```bash
npx nx build realtime-chat
npx nx run realtime-chat:build-web   # bundles src/web/app.ts -> public/app.js via esbuild
npx nx run realtime-chat:serve       # http://localhost:3001
```

Open two browser tabs at `http://localhost:3001`, register (or log in) in each, and post a
message in one — it appears in both immediately over the socket.

Storage is a local SQLite file (`chat.db`, created next to wherever the process runs); delete it
to reset. See [`src/app.ts`](./src/app.ts) for the full service/hook wiring and
[`src/web/app.ts`](./src/web/app.ts) for the client.
